"""
Image Migration Script: Olive Garden CDN -> DigitalOcean Spaces -> MongoDB Update
Restaurant: Olive Garden

Pipeline:
  MongoDB (Olive Garden CDN + Cloudinary URLs) -> Download -> Upload to DO Spaces -> Update MongoDB

Data structure (mixed pattern — both coexist in the SAME category):
  restaurant
    └── categories[]
          ├── dishes[]                          <- direct dishes (all categories)
          │     └── servingInfos[].servingInfo.Url
          └── subCategories[]                   <- also present in Appetizers,
                └── dishes[]                       Desserts, Non-Alcoholic Drinks
                      └── servingInfos[].servingInfo.Url

  restaurant.logo                               <- Cloudinary, also migrated

Special cases handled:
  - Empty Url ("") entries are silently skipped
  - http:// URLs (one dessert image) are downloaded without forcing https
  - media.olivegarden.com is the primary source CDN for dish images
  - res.cloudinary.com is used for the logo
  - Windows UTF-8 encoding fix applied throughout

Requirements:
    pip install pymongo boto3 requests python-dotenv

Setup .env file with:
    MONGO_URI=mongodb+srv://...
    DO_SPACES_KEY=your_access_key
    DO_SPACES_SECRET=your_secret_key
    DO_SPACES_BUCKET=your_bucket_name
    DO_SPACES_REGION=nyc3
    DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
    DO_CDN_BASE_URL=https://your-bucket.nyc3.cdn.digitaloceanspaces.com  # optional
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

# ---- Config ------------------------------------------------------------------

load_dotenv()

MONGO_URI       = os.getenv("MONGO_URI")
DB_NAME         = "hungerX"
COLLECTION_NAME = "restaurants"

DO_SPACES_KEY      = os.getenv("DO_SPACES_KEY")
DO_SPACES_SECRET   = os.getenv("DO_SPACES_SECRET")
DO_SPACES_BUCKET   = os.getenv("DO_SPACES_BUCKET")
DO_SPACES_REGION   = os.getenv("DO_SPACES_REGION", "nyc3")
DO_SPACES_ENDPOINT = os.getenv("DO_SPACES_ENDPOINT", f"https://{DO_SPACES_REGION}.digitaloceanspaces.com")
DO_CDN_BASE_URL    = os.getenv("DO_CDN_BASE_URL", "").rstrip("/")

DO_BASE_FOLDER  = "restaurants"
MAX_RETRIES     = 3
RETRY_DELAY     = 2   # seconds
REQUEST_TIMEOUT = 30  # seconds

TARGET_RESTAURANT = "Olive Garden"

# Olive Garden dish images come from their own CDN.
# The logo comes from Cloudinary.
SOURCE_DOMAINS = (
    "media.olivegarden.com",  # primary image CDN for all dish/product images
    "res.cloudinary.com",     # logo only
)

# ---- Logging (Windows UTF-8 safe) --------------------------------------------
#
# Forces UTF-8 on the log file and uses errors="replace" on the console
# so no UnicodeEncodeError on Windows regardless of terminal encoding.

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

_console_stream = open(
    sys.stdout.fileno(),
    mode="w",
    encoding=sys.stdout.encoding or "utf-8",
    errors="replace",
    closefd=False,
    buffering=1,
)
_console = logging.StreamHandler(_console_stream)
_console.setFormatter(_fmt)
log.addHandler(_console)

_file = logging.FileHandler("olive_garden_migration.log", encoding="utf-8")
_file.setFormatter(_fmt)
log.addHandler(_file)

# ---- DigitalOcean Spaces Client ----------------------------------------------

def get_spaces_client():
    session = boto3.session.Session()
    return session.client(
        "s3",
        region_name=DO_SPACES_REGION,
        endpoint_url=DO_SPACES_ENDPOINT,
        aws_access_key_id=DO_SPACES_KEY,
        aws_secret_access_key=DO_SPACES_SECRET,
    )

# ---- Helpers -----------------------------------------------------------------

def slugify(text: str) -> str:
    """Convert text to a safe lowercase slug for use in file paths."""
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "_", text)
    return text.strip("_")


def is_already_on_do(url: str) -> bool:
    """Return True if the URL already lives on DigitalOcean Spaces / CDN."""
    return DO_SPACES_BUCKET in url or "digitaloceanspaces" in url


def needs_migration(url: str) -> bool:
    """Return True if the URL is from a known source domain we want to move."""
    parsed = urlparse(url)
    return any(domain in parsed.netloc for domain in SOURCE_DOMAINS)


def normalise_url(url: str) -> str:
    """
    Olive Garden has one image served over plain http://.
    We accept it as-is — requests handles both schemes fine.
    No modification needed, but this function is here for clarity.
    """
    return url.strip()


def get_extension_from_url(url: str, content_type: str = "") -> str:
    """
    Derive file extension from the URL path.
    Olive Garden paths look like:
      /en_us/images/product/calamari-dpv-590x365.jpg
      /en_us/images/product/lasagna-classico-dpv-1180x730.png
    """
    path = urlparse(url).path
    ext  = Path(path).suffix.lower()

    if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"):
        return ext

    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".jpg"
        return ".jpg" if guessed == ".jpeg" else guessed

    return ".jpg"


def download_image(url: str) -> tuple[bytes, str]:
    """
    Download image from the given URL.
    Handles both http:// and https:// schemes.
    Returns (raw_bytes, file_extension).
    """
    clean_url = normalise_url(url)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(clean_url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            ext = get_extension_from_url(clean_url, resp.headers.get("Content-Type", ""))
            return resp.content, ext
        except requests.RequestException as exc:
            log.warning(
                "  Download attempt %d/%d failed for %s: %s",
                attempt, MAX_RETRIES, clean_url, exc,
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)

    raise RuntimeError(f"Failed to download after {MAX_RETRIES} attempts: {clean_url}")


def upload_to_spaces(client, data: bytes, key: str, ext: str) -> str:
    """Upload image bytes to DO Spaces and return the public URL."""
    content_type_map = {
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png":  "image/png",
        ".gif":  "image/gif",
        ".webp": "image/webp",
        ".svg":  "image/svg+xml",
        ".avif": "image/avif",
    }
    content_type = content_type_map.get(ext, "application/octet-stream")

    client.upload_fileobj(
        BytesIO(data),
        DO_SPACES_BUCKET,
        key,
        ExtraArgs={
            "ACL": "public-read",
            "ContentType": content_type,
            "CacheControl": "max-age=31536000",
        },
    )

    if DO_CDN_BASE_URL:
        return f"{DO_CDN_BASE_URL}/{key}"
    return f"{DO_SPACES_ENDPOINT}/{DO_SPACES_BUCKET}/{key}"


def build_spaces_key(
    restaurant_name: str,
    category_name: str,
    dish_name: str,
    filename: str,
    subcat_name: str = "",
) -> str:
    """
    Build the storage path inside the bucket.

    Without subCategory:
      restaurants/olive_garden/appetizers/calamari/1.jpg
      restaurants/olive_garden/sides_and_sauces/marinara_sauce/regular.jpg

    With subCategory:
      restaurants/olive_garden/non_alcoholic_drinks/to_go_fountain_drinks/coke/1.jpg
      restaurants/olive_garden/appetizers/included_sauces/alfredo/1.jpg
    """
    parts = [
        DO_BASE_FOLDER,
        slugify(restaurant_name),
        slugify(category_name),
    ]
    if subcat_name:
        parts.append(slugify(subcat_name))
    parts.append(slugify(dish_name))
    parts.append(filename)
    return "/".join(parts)


def make_filename(size: str, idx: int, ext: str) -> str:
    """
    Build a collision-free filename from serving size and index.

    Examples:
      size="1"         idx=0  -> "1.jpg"
      size="Regular"   idx=0  -> "regular.jpg"
      size="3 piece"   idx=0  -> "3_piece.jpg"
      size="1"         idx=1  -> "1_1.jpg"  (collision guard)
    """
    size_slug = slugify(size) if size else "default"
    if idx == 0:
        return f"{size_slug}{ext}"
    return f"{size_slug}_{idx}{ext}"

# ---- Core Migration Logic ----------------------------------------------------

def migrate_serving_infos(
    spaces_client,
    serving_infos: list,
    restaurant_name: str,
    category_name: str,
    dish_name: str,
    subcat_name: str = "",
    dry_run: bool = False,
) -> tuple[bool, list]:
    """
    Process every servingInfo entry for a dish.
    Skips entries with empty URLs silently.
    Downloads from source CDN and re-uploads to DigitalOcean Spaces.
    Returns (changed, updated_serving_infos).
    """
    changed = False

    for idx, entry in enumerate(serving_infos):
        si      = entry.get("servingInfo", {})
        old_url = si.get("Url", "").strip()

        # Silently skip empty URL fields (common in Olive Garden sauce sub-items)
        if not old_url:
            log.debug("      -> [%d] Empty URL, skipping.", idx)
            continue

        if is_already_on_do(old_url):
            log.info("      -> [%d] Already on DO, skipping: %s", idx, old_url)
            continue

        if not needs_migration(old_url):
            log.warning("      -> [%d] Unknown source domain, skipping: %s", idx, old_url)
            continue

        log.info("      -> [%d] %s", idx, old_url)

        if dry_run:
            log.info("        [DRY RUN] Would download and upload.")
            continue

        try:
            img_data, ext = download_image(old_url)
            filename = make_filename(si.get("size", "default"), idx, ext)
            key = build_spaces_key(
                restaurant_name, category_name, dish_name, filename, subcat_name
            )
            new_url = upload_to_spaces(spaces_client, img_data, key, ext)
            log.info("        OK Uploaded -> %s", new_url)

            serving_infos[idx]["servingInfo"]["Url"] = new_url
            changed = True

        except Exception as exc:
            log.error("        FAILED processing %s: %s", old_url, exc)

    return changed, serving_infos


def migrate_restaurant_logo(
    spaces_client,
    restaurant_doc: dict,
    dry_run: bool = False,
) -> tuple[bool, str]:
    """
    Migrate the top-level `logo` field if still on Cloudinary.
    Returns (changed, new_logo_url).
    """
    logo_url = restaurant_doc.get("logo", "").strip()

    if not logo_url:
        return False, logo_url

    if is_already_on_do(logo_url):
        log.info("  Logo already on DO, skipping: %s", logo_url)
        return False, logo_url

    if not needs_migration(logo_url):
        log.warning("  Logo from unknown domain, skipping: %s", logo_url)
        return False, logo_url

    log.info("  Logo: %s", logo_url)

    if dry_run:
        log.info("  [DRY RUN] Would migrate logo.")
        return False, logo_url

    try:
        img_data, ext = download_image(logo_url)
        restaurant_name = restaurant_doc.get("restaurantName", "unknown")
        key = f"{DO_BASE_FOLDER}/{slugify(restaurant_name)}/logo{ext}"
        new_url = upload_to_spaces(spaces_client, img_data, key, ext)
        log.info("  OK Logo uploaded -> %s", new_url)
        return True, new_url
    except Exception as exc:
        log.error("  FAILED migrating logo: %s", exc)
        return False, logo_url


def migrate_dishes(
    spaces_client,
    dishes: list,
    restaurant_name: str,
    category_name: str,
    subcat_name: str = "",
    dry_run: bool = False,
) -> bool:
    """
    Migrate all dishes in a list (shared helper for direct dishes and subcat dishes).
    Returns True if any image changed.
    """
    any_changed = False

    for dish in dishes:
        dish_name = dish.get("dishName", "unknown").strip()
        log.info("      Dish: %s", dish_name)

        changed, updated_sis = migrate_serving_infos(
            spaces_client,
            dish.get("servingInfos", []),
            restaurant_name,
            category_name,
            dish_name,
            subcat_name=subcat_name,
            dry_run=dry_run,
        )
        if changed:
            dish["servingInfos"] = updated_sis
            any_changed = True

    return any_changed


def migrate_restaurant(restaurant_doc: dict, dry_run: bool = False) -> list[UpdateOne]:
    """
    Migrate all images for a single Olive Garden restaurant document.

    Each category may contain:
      - dishes[]         (direct)
      - subCategories[]  (nested, with their own dishes[])
    Both are processed for every category.

    Returns a list of MongoDB bulk write operations to apply.
    """
    spaces_client   = get_spaces_client()
    restaurant_name = restaurant_doc.get("restaurantName", "unknown")
    bulk_ops        = []

    log.info("")
    log.info("=" * 60)
    log.info("Restaurant: %s", restaurant_name)
    log.info("=" * 60)

    # Migrate logo
    logo_changed, new_logo = migrate_restaurant_logo(
        spaces_client, restaurant_doc, dry_run=dry_run
    )

    # Migrate dish images
    categories   = restaurant_doc.get("categories", [])
    cats_changed = False

    for cat in categories:
        category_name = cat.get("categoryName", "unknown").strip()
        log.info("")
        log.info("  Category: %s", category_name)

        # ── Direct dishes (present in ALL categories) ─────────────────────────
        direct_dishes = cat.get("dishes", [])
        if direct_dishes:
            log.info("    [Direct dishes]")
            if migrate_dishes(
                spaces_client, direct_dishes,
                restaurant_name, category_name,
                dry_run=dry_run,
            ):
                cats_changed = True

        # ── SubCategories (Appetizers, Desserts, Non-Alcoholic Drinks) ────────
        for subcat in cat.get("subCategories", []):
            subcat_name = subcat.get("subCategoryName", "unknown").strip()
            log.info("")
            log.info("    SubCategory: %s", subcat_name)

            if migrate_dishes(
                spaces_client,
                subcat.get("dishes", []),
                restaurant_name,
                category_name,
                subcat_name=subcat_name,
                dry_run=dry_run,
            ):
                cats_changed = True

    # Build the MongoDB update only if something actually changed
    if not dry_run and (logo_changed or cats_changed):
        update_fields: dict = {}
        if cats_changed:
            update_fields["categories"] = categories
        if logo_changed:
            update_fields["logo"] = new_logo

        bulk_ops.append(
            UpdateOne(
                {"_id": restaurant_doc["_id"]},
                {"$set": update_fields},
            )
        )

    return bulk_ops


# ---- Runner ------------------------------------------------------------------

def run_migration(dry_run: bool = False):
    mongo_client = MongoClient(MONGO_URI)
    db           = mongo_client[DB_NAME]
    collection   = db[COLLECTION_NAME]

    query = {"restaurantName": TARGET_RESTAURANT}
    total = collection.count_documents(query)

    log.info("Target     : %s", TARGET_RESTAURANT)
    log.info("Documents  : %d", total)
    log.info("Dry run    : %s", dry_run)
    log.info("=" * 60)

    if total == 0:
        log.warning(
            "No document found for '%s'. Check the name and DB.", TARGET_RESTAURANT
        )
        mongo_client.close()
        return

    all_bulk_ops = []

    for doc in collection.find(query):
        try:
            ops = migrate_restaurant(doc, dry_run=dry_run)
            all_bulk_ops.extend(ops)
        except Exception as exc:
            log.error("Fatal error processing document %s: %s", doc.get("_id"), exc)

    if all_bulk_ops and not dry_run:
        result = collection.bulk_write(all_bulk_ops, ordered=False)
        log.info("")
        log.info("DB updated: %d document(s) modified", result.modified_count)
    elif dry_run:
        log.info("")
        log.info("[DRY RUN] No changes written to DB.")

    log.info("")
    log.info("=" * 60)
    log.info("Migration complete.")
    log.info("=" * 60)

    mongo_client.close()


# ---- CLI ---------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Migrate Olive Garden images: OG CDN -> DigitalOcean Spaces"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would happen without making any changes",
    )
    args = parser.parse_args()

    run_migration(dry_run=args.dry_run)