"""
Image Migration Script: Multi-CDN -> DigitalOcean Spaces -> MongoDB Update
Restaurant: Burger King

Pipeline:
  MongoDB (multiple CDN URLs) -> Download -> Upload to DO Spaces -> Update MongoDB

Data structure (simplest so far — NO subCategories anywhere):
  restaurant
    └── categories[]
          └── dishes[]
                └── servingInfos[].servingInfo.Url   <- image to migrate
  restaurant.logo                                    <- Cloudinary, also migrated

Image sources confirmed from actual data:
  cdn.sanity.io/images/kjfd81ul  (main BK Sanity project — Breakfast, Burgers,
                                  Sides, Drinks, Sweets — the majority of images)
  cdn.sanity.io/images/czqk28jt  (alt Sanity project — FG Chicken Wraps,
                                  Bottle Coke / Diet Coke / Sprite)
  tb-static.uber.com             (Uber Eats CDN — Shroom n' Swiss Melt,
                                  Bacon and Swiss FG Chicken Sandwich, Churro Fries)
  bk-latam-prod.s3.amazonaws.com (BK LATAM S3 — Fiery + Classic FG Chicken Sandwich)
  fastfoodnutrition.org          (third-party — French Onion Melt, Pickle Fries)
  www.foodandwine.com            (Food & Wine — Bacon Melt, Classic Melt)
  people.com                     (People magazine — Cheesy Tots)
  res.cloudinary.com             (logo only)

Key technical notes:
  - Sanity CDN URLs carry resize/quality params (?w=...&q=...&fit=...&auto=...)
    that are stripped before downloading so we get the original stored asset.
  - All other domains are downloaded as-is (no query params to strip).
  - No subCategories exist in the BK data — only categories → dishes → servingInfos.
  - No empty Url fields exist in the BK data, but empty-string guard is kept
    for safety.
  - Windows UTF-8 encoding fix applied throughout.
  - Safe to re-run: images already on DO Spaces are detected and skipped.

Requirements:
    pip install pymongo boto3 requests python-dotenv

Setup .env:
    MONGO_URI=mongodb+srv://...
    DO_SPACES_KEY=your_access_key
    DO_SPACES_SECRET=your_secret_key
    DO_SPACES_BUCKET=your_bucket_name
    DO_SPACES_REGION=nyc3
    DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
    DO_CDN_BASE_URL=https://your-bucket.nyc3.cdn.digitaloceanspaces.com  # optional

Run:
    python burger_king_migration.py --dry-run   # preview, no changes
    python burger_king_migration.py             # live run
"""

import os
import re
import sys
import time
import logging
import mimetypes
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from dotenv import load_dotenv

import requests
import boto3
from pymongo import MongoClient, UpdateOne

# ── Config ────────────────────────────────────────────────────────────────────

load_dotenv()

MONGO_URI          = os.getenv("MONGO_URI")
DB_NAME            = "hungerX"
COLLECTION_NAME    = "restaurants"

DO_SPACES_KEY      = os.getenv("DO_SPACES_KEY")
DO_SPACES_SECRET   = os.getenv("DO_SPACES_SECRET")
DO_SPACES_BUCKET   = os.getenv("DO_SPACES_BUCKET")
DO_SPACES_REGION   = os.getenv("DO_SPACES_REGION", "nyc3")
DO_SPACES_ENDPOINT = os.getenv("DO_SPACES_ENDPOINT",
                                f"https://{os.getenv('DO_SPACES_REGION','nyc3')}.digitaloceanspaces.com")
DO_CDN_BASE_URL    = os.getenv("DO_CDN_BASE_URL", "").rstrip("/")

DO_BASE_FOLDER  = "restaurants"
MAX_RETRIES     = 3
RETRY_DELAY     = 2   # seconds between retries
REQUEST_TIMEOUT = 30  # seconds per HTTP request

TARGET_RESTAURANT = "Burger King"

# All source domains confirmed present in the BK document.
# Any URL whose domain is NOT in this tuple is skipped with a WARNING so you
# can spot unexpected image hosts without silently losing them.
SOURCE_DOMAINS = (
    "cdn.sanity.io",                    # both kjfd81ul and czqk28jt project IDs
    "tb-static.uber.com",               # Uber Eats CDN
    "bk-latam-prod.s3.amazonaws.com",   # BK Latin America S3
    "fastfoodnutrition.org",            # third-party nutrition site
    "www.foodandwine.com",              # Food & Wine magazine
    "people.com",                       # People magazine
    "res.cloudinary.com",               # logo
)

# Domains whose URLs include on-the-fly transformation query parameters.
# Only Sanity CDN applies these in the BK data; the others are plain URLs.
# Stripping gives us the clean original asset, not a resized/reformatted proxy.
STRIP_QUERY_DOMAINS = (
    "cdn.sanity.io",
)

# ── Logging (Windows-safe UTF-8) ──────────────────────────────────────────────
#
# FileHandler is forced to UTF-8 so the log file is always readable.
# The console stream uses errors="replace" so non-ASCII bytes (e.g. ® ™ in
# dish names) never raise UnicodeEncodeError on Windows cp1252 terminals.

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

_con_stream = open(
    sys.stdout.fileno(),
    mode="w",
    encoding=sys.stdout.encoding or "utf-8",
    errors="replace",
    closefd=False,
    buffering=1,
)
_console = logging.StreamHandler(_con_stream)
_console.setFormatter(_fmt)
log.addHandler(_console)

_file_handler = logging.FileHandler("burger_king_migration.log", encoding="utf-8")
_file_handler.setFormatter(_fmt)
log.addHandler(_file_handler)

# ── DigitalOcean Spaces client ────────────────────────────────────────────────

def get_spaces_client():
    session = boto3.session.Session()
    return session.client(
        "s3",
        region_name=DO_SPACES_REGION,
        endpoint_url=DO_SPACES_ENDPOINT,
        aws_access_key_id=DO_SPACES_KEY,
        aws_secret_access_key=DO_SPACES_SECRET,
    )

# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Convert arbitrary text into a filesystem-safe lowercase slug."""
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)          # drop special chars
    text = re.sub(r"[\s_-]+", "_", text)           # collapse whitespace/dashes
    return text.strip("_")


def maybe_strip_query(url: str) -> str:
    """
    Remove query string and fragment from Sanity CDN URLs so we download the
    original asset rather than a resized/reformatted proxy.
    All other domains are returned unchanged.

    Sanity example:
      https://cdn.sanity.io/images/kjfd81ul/prod_bk_us/abc123.png?w=1800&q=75&fit=max&auto=format
      ->
      https://cdn.sanity.io/images/kjfd81ul/prod_bk_us/abc123.png
    """
    parsed = urlparse(url)
    if any(d in parsed.netloc for d in STRIP_QUERY_DOMAINS):
        return urlunparse(parsed._replace(query="", fragment=""))
    return url


def is_already_on_do(url: str) -> bool:
    """True if the URL already points at our DigitalOcean Spaces bucket / CDN."""
    return DO_SPACES_BUCKET in url or "digitaloceanspaces" in url


def needs_migration(url: str) -> bool:
    """True if the URL belongs to a known source domain we intend to migrate."""
    return any(d in urlparse(url).netloc for d in SOURCE_DOMAINS)


def get_extension(url: str, content_type: str = "") -> str:
    """
    Derive a file extension from the cleaned URL path, falling back to the
    HTTP Content-Type header, then defaulting to .jpg.

    Works correctly for:
      Sanity  : /images/kjfd81ul/prod_bk_us/abc123-1333x1333.png   -> .png
      Uber    : /processed_images/abc123.jpeg                       -> .jpeg
      S3      : /sites/burgerking.bs/files/FG_CHKN_Burger.png       -> .png
      FoodWine: /...filters.../Burger-Kings-...Bacon-Melt-abc.jpeg  -> .jpeg
      People  : /...filters.../cheesy-abc.jpg                       -> .jpg
      FFN     : /item-photos/full/123456.png                        -> .png
    """
    clean = maybe_strip_query(url)
    ext = Path(urlparse(clean).path).suffix.lower()
    if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"):
        return ext
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".jpg"
        return ".jpg" if guessed == ".jpeg" else guessed
    return ".jpg"


def download_image(url: str) -> tuple[bytes, str]:
    """
    Download image bytes from url (stripping Sanity query params first).
    Retries up to MAX_RETRIES times on network errors.
    Returns (bytes, extension).
    """
    clean_url = maybe_strip_query(url).strip()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(clean_url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            ext = get_extension(clean_url, resp.headers.get("Content-Type", ""))
            return resp.content, ext
        except requests.RequestException as exc:
            log.warning(
                "      Download attempt %d/%d failed for %s: %s",
                attempt, MAX_RETRIES, clean_url, exc,
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)

    raise RuntimeError(
        f"All {MAX_RETRIES} download attempts failed: {clean_url}"
    )


def upload_to_spaces(client, data: bytes, key: str, ext: str) -> str:
    """Upload bytes to DO Spaces at the given key and return the public URL."""
    content_type_map = {
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png":  "image/png",
        ".gif":  "image/gif",
        ".webp": "image/webp",
        ".svg":  "image/svg+xml",
        ".avif": "image/avif",
    }
    client.upload_fileobj(
        BytesIO(data),
        DO_SPACES_BUCKET,
        key,
        ExtraArgs={
            "ACL":          "public-read",
            "ContentType":  content_type_map.get(ext, "application/octet-stream"),
            "CacheControl": "max-age=31536000",
        },
    )
    if DO_CDN_BASE_URL:
        return f"{DO_CDN_BASE_URL}/{key}"
    return f"{DO_SPACES_ENDPOINT}/{DO_SPACES_BUCKET}/{key}"


def build_spaces_key(
    restaurant_slug: str,
    category_slug: str,
    dish_slug: str,
    filename: str,
) -> str:
    """
    Compose the object key (path inside the bucket).

    Pattern:
      restaurants/<restaurant>/<category>/<dish>/<filename>

    Examples:
      restaurants/burger_king/breakfast/french_toast_sticks/5_pc.png
      restaurants/burger_king/flame_grilled_burgers/whopper/1.png
      restaurants/burger_king/sides/french_fries/value.png
      restaurants/burger_king/chicken_fish/chicken_nuggets/4_pc.png
      restaurants/burger_king/drinks_coffee/coca_cola/value.png
      restaurants/burger_king/sweets/churro_fries/4_pc.jpeg
    """
    return f"{DO_BASE_FOLDER}/{restaurant_slug}/{category_slug}/{dish_slug}/{filename}"


def make_filename(size: str, idx: int, ext: str) -> str:
    """
    Build a filename that is both human-readable and collision-free.

    The size label is slugified; idx > 0 appends a numeric suffix so two
    servingInfos with the same size string never overwrite each other.

    Examples:
      size="5 Pc."    idx=0  -> "5_pc.png"
      size="Small "   idx=0  -> "small.png"
      size="1"        idx=0  -> "1.png"
      size="8 Pc. "   idx=1  -> "8_pc_1.png"   (collision guard)
      size=""         idx=0  -> "default.png"
    """
    size_slug = slugify(size) if size.strip() else "default"
    if idx == 0:
        return f"{size_slug}{ext}"
    return f"{size_slug}_{idx}{ext}"

# ── Core migration logic ──────────────────────────────────────────────────────

def migrate_serving_infos(
    spaces_client,
    serving_infos: list,
    restaurant_slug: str,
    category_slug: str,
    dish_slug: str,
    dry_run: bool = False,
) -> tuple[bool, list]:
    """
    Iterate every servingInfo for a dish and migrate its image.
    Returns (any_changed, updated_serving_infos).
    """
    changed = False

    for idx, entry in enumerate(serving_infos):
        si      = entry.get("servingInfo", {})
        old_url = si.get("Url", "").strip()

        if not old_url:
            log.debug("        [%d] Empty URL — skipping.", idx)
            continue

        if is_already_on_do(old_url):
            log.info("        [%d] Already on DO — skipping.", idx)
            continue

        if not needs_migration(old_url):
            log.warning("        [%d] Unrecognised source domain — skipping: %s", idx, old_url)
            continue

        log.info("        [%d] %s", idx, old_url)

        if dry_run:
            log.info("          [DRY RUN] Would download and upload.")
            continue

        try:
            img_data, ext = download_image(old_url)
            filename = make_filename(si.get("size", ""), idx, ext)
            key = build_spaces_key(restaurant_slug, category_slug, dish_slug, filename)
            new_url = upload_to_spaces(spaces_client, img_data, key, ext)
            log.info("          OK -> %s", new_url)

            serving_infos[idx]["servingInfo"]["Url"] = new_url
            changed = True

        except Exception as exc:
            log.error("          FAILED: %s", exc)

    return changed, serving_infos


def migrate_logo(
    spaces_client,
    doc: dict,
    restaurant_slug: str,
    dry_run: bool = False,
) -> tuple[bool, str]:
    """
    Migrate the top-level logo field.
    Returns (changed, new_or_original_url).
    """
    logo_url = doc.get("logo", "").strip()

    if not logo_url:
        return False, logo_url

    if is_already_on_do(logo_url):
        log.info("  Logo: already on DO — skipping.")
        return False, logo_url

    if not needs_migration(logo_url):
        log.warning("  Logo: unrecognised domain — skipping: %s", logo_url)
        return False, logo_url

    log.info("  Logo: %s", logo_url)

    if dry_run:
        log.info("  [DRY RUN] Would migrate logo.")
        return False, logo_url

    try:
        img_data, ext = download_image(logo_url)
        key     = f"{DO_BASE_FOLDER}/{restaurant_slug}/logo{ext}"
        new_url = upload_to_spaces(spaces_client, img_data, key, ext)
        log.info("  Logo OK -> %s", new_url)
        return True, new_url
    except Exception as exc:
        log.error("  Logo FAILED: %s", exc)
        return False, logo_url


def migrate_restaurant(doc: dict, dry_run: bool = False) -> list[UpdateOne]:
    """
    Migrate all images in one Burger King MongoDB document.

    BK structure (confirmed from actual data):
      categories[]
        dishes[]                <- NO subCategories anywhere
          servingInfos[]
            servingInfo.Url

    Returns a list of MongoDB UpdateOne operations (empty if nothing changed).
    """
    spaces_client   = get_spaces_client()
    restaurant_name = doc.get("restaurantName", "unknown")
    restaurant_slug = slugify(restaurant_name)
    bulk_ops        = []

    log.info("")
    log.info("=" * 60)
    log.info("Restaurant : %s", restaurant_name)
    log.info("=" * 60)

    # ── Logo ──────────────────────────────────────────────────────────────────
    logo_changed, new_logo = migrate_logo(
        spaces_client, doc, restaurant_slug, dry_run=dry_run
    )

    # ── Categories → Dishes ───────────────────────────────────────────────────
    categories   = doc.get("categories", [])
    cats_changed = False

    for cat in categories:
        category_name = cat.get("categoryName", "unknown").strip()
        category_slug = slugify(category_name)
        log.info("")
        log.info("  Category: %s", category_name)

        for dish in cat.get("dishes", []):
            dish_name = dish.get("dishName", "unknown").strip()
            dish_slug = slugify(dish_name)
            log.info("    Dish: %s", dish_name)

            changed, updated_sis = migrate_serving_infos(
                spaces_client,
                dish.get("servingInfos", []),
                restaurant_slug,
                category_slug,
                dish_slug,
                dry_run=dry_run,
            )
            if changed:
                dish["servingInfos"] = updated_sis
                cats_changed = True

        # BK has no subCategories, but guard future-proofs against data changes
        for subcat in cat.get("subCategories", []):
            subcat_name = subcat.get("subCategoryName", "unknown").strip()
            subcat_slug = slugify(subcat_name)
            log.info("")
            log.info("    SubCategory: %s", subcat_name)

            for dish in subcat.get("dishes", []):
                dish_name = dish.get("dishName", "unknown").strip()
                dish_slug = slugify(dish_name)
                log.info("      Dish: %s", dish_name)

                changed, updated_sis = migrate_serving_infos(
                    spaces_client,
                    dish.get("servingInfos", []),
                    restaurant_slug,
                    f"{category_slug}/{subcat_slug}",
                    dish_slug,
                    dry_run=dry_run,
                )
                if changed:
                    dish["servingInfos"] = updated_sis
                    cats_changed = True

    # ── Build MongoDB update ───────────────────────────────────────────────────
    if not dry_run and (logo_changed or cats_changed):
        update_fields: dict = {}
        if cats_changed:
            update_fields["categories"] = categories
        if logo_changed:
            update_fields["logo"] = new_logo

        bulk_ops.append(
            UpdateOne({"_id": doc["_id"]}, {"$set": update_fields})
        )

    return bulk_ops

# ── Runner ────────────────────────────────────────────────────────────────────

def run_migration(dry_run: bool = False) -> None:
    client     = MongoClient(MONGO_URI)
    collection = client[DB_NAME][COLLECTION_NAME]
    query      = {"restaurantName": TARGET_RESTAURANT}
    total      = collection.count_documents(query)

    log.info("Target   : %s", TARGET_RESTAURANT)
    log.info("Documents: %d", total)
    log.info("Dry run  : %s", dry_run)
    log.info("=" * 60)

    if total == 0:
        log.warning("No document found for '%s'. Check restaurantName in DB.", TARGET_RESTAURANT)
        client.close()
        return

    all_ops: list[UpdateOne] = []

    for doc in collection.find(query):
        try:
            ops = migrate_restaurant(doc, dry_run=dry_run)
            all_ops.extend(ops)
        except Exception as exc:
            log.error("Fatal error on document %s: %s", doc.get("_id"), exc)

    if all_ops and not dry_run:
        result = collection.bulk_write(all_ops, ordered=False)
        log.info("")
        log.info("DB updated: %d document(s) modified.", result.modified_count)
    elif dry_run:
        log.info("")
        log.info("[DRY RUN] No changes written to DB.")

    log.info("")
    log.info("=" * 60)
    log.info("Migration complete.")
    log.info("=" * 60)
    client.close()

# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Migrate Burger King images from multiple CDNs to DigitalOcean Spaces."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and log everything without downloading, uploading, or modifying MongoDB.",
    )
    args = parser.parse_args()
    run_migration(dry_run=args.dry_run)