"""
Image Migration Script: Tillster CDN → DigitalOcean Spaces → MongoDB Update
Restaurant: Baskin-Robbins

Pipeline:
  MongoDB (Tillster CDN URLs) → Download → Upload to DO Spaces → Update MongoDB

Data structure:
  restaurant
    └── categories[]
          └── dishes[]
                └── servingInfos[].servingInfo.Url   ← image to migrate

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
import time
import logging
import mimetypes
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

import requests
import boto3
from pymongo import MongoClient, UpdateOne

# ─── Config ───────────────────────────────────────────────────────────────────

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

# ─── Target Restaurant ────────────────────────────────────────────────────────

TARGET_RESTAURANT = "Baskin-Robbins"

# ─── Source domains to migrate (anything NOT already on DO gets migrated) ─────
# Add any CDN / origin domains whose images should be moved to DO Spaces.
SOURCE_DOMAINS = (
    "brm-cdn.tillster.com",
    "res.cloudinary.com",   # in case logo or future dishes use Cloudinary
)

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("baskin_robbins_migration.log"),
    ],
)
log = logging.getLogger(__name__)

# ─── DigitalOcean Spaces Client ───────────────────────────────────────────────

def get_spaces_client():
    session = boto3.session.Session()
    return session.client(
        "s3",
        region_name=DO_SPACES_REGION,
        endpoint_url=DO_SPACES_ENDPOINT,
        aws_access_key_id=DO_SPACES_KEY,
        aws_secret_access_key=DO_SPACES_SECRET,
    )

# ─── Helpers ──────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "_", text)
    return text


def is_already_on_do(url: str) -> bool:
    """Return True if the URL already lives on DigitalOcean Spaces / CDN."""
    return DO_SPACES_BUCKET in url or "digitaloceanspaces" in url


def needs_migration(url: str) -> bool:
    """Return True if the URL comes from a known source domain we want to move."""
    parsed = urlparse(url)
    return any(domain in parsed.netloc for domain in SOURCE_DOMAINS)


def get_extension_from_url(url: str, content_type: str = "") -> str:
    path = urlparse(url).path
    ext  = Path(path).suffix.lower()
    if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"):
        return ext
    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".jpg"
        return ".jpg" if ext == ".jpeg" else ext
    return ".jpg"


def download_image(url: str) -> tuple[bytes, str]:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            ext = get_extension_from_url(url, resp.headers.get("Content-Type", ""))
            return resp.content, ext
        except requests.RequestException as e:
            log.warning(f"  Download attempt {attempt}/{MAX_RETRIES} failed for {url}: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
    raise RuntimeError(f"Failed to download after {MAX_RETRIES} attempts: {url}")


def upload_to_spaces(client, data: bytes, key: str, ext: str) -> str:
    content_type_map = {
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png":  "image/png",
        ".gif":  "image/gif",
        ".webp": "image/webp",
        ".svg":  "image/svg+xml",
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
) -> str:
    """
    Path structure inside bucket:
      restaurants/baskin_robbins/flavors/chocolate/2_5_oz.png
      restaurants/baskin_robbins/beverages/mangonada/small_16oz.png
    """
    return "/".join([
        DO_BASE_FOLDER,
        slugify(restaurant_name),
        slugify(category_name),
        slugify(dish_name),
        filename,
    ])

# ─── Core Migration Logic ─────────────────────────────────────────────────────

def migrate_serving_infos(
    spaces_client,
    serving_infos: list,
    restaurant_name: str,
    category_name: str,
    dish_name: str,
    dry_run: bool = False,
) -> tuple[bool, list]:
    """
    Iterate every servingInfo entry, download its image from the source CDN
    and re-upload it to DigitalOcean Spaces.  Returns (changed, updated_list).
    """
    changed = False

    for idx, entry in enumerate(serving_infos):
        si      = entry.get("servingInfo", {})
        old_url = si.get("Url", "")

        if not old_url:
            continue

        # Skip if the image already lives on DigitalOcean
        if is_already_on_do(old_url):
            log.info(f"    ↳ [{idx}] Already on DO, skipping: {old_url}")
            continue

        # Skip if the URL is from an unexpected domain (safety guard)
        if not needs_migration(old_url):
            log.warning(f"    ↳ [{idx}] Unknown source domain, skipping: {old_url}")
            continue

        log.info(f"    ↳ [{idx}] {old_url}")

        if dry_run:
            log.info("      [DRY RUN] Would download & upload.")
            continue

        try:
            img_data, ext = download_image(old_url)

            # Use the serving size as the filename (e.g. "2_5_oz.png")
            size_slug = slugify(si.get("size", "default"))
            filename  = f"{size_slug}{ext}"

            key = build_spaces_key(
                restaurant_name, category_name, dish_name, filename
            )

            new_url = upload_to_spaces(spaces_client, img_data, key, ext)
            log.info(f"      ✓ Uploaded → {new_url}")

            serving_infos[idx]["servingInfo"]["Url"] = new_url
            changed = True

        except Exception as exc:
            log.error(f"      ✗ Error processing {old_url}: {exc}")

    return changed, serving_infos


def migrate_restaurant_logo(
    spaces_client,
    restaurant_doc: dict,
    dry_run: bool = False,
) -> tuple[bool, str]:
    """
    Migrate the top-level `logo` field if it still points to an external CDN.
    Returns (changed, new_logo_url).
    """
    logo_url = restaurant_doc.get("logo", "")

    if not logo_url:
        return False, logo_url

    if is_already_on_do(logo_url):
        log.info(f"  Logo already on DO, skipping: {logo_url}")
        return False, logo_url

    if not needs_migration(logo_url):
        log.warning(f"  Logo from unknown domain, skipping: {logo_url}")
        return False, logo_url

    log.info(f"  Logo: {logo_url}")

    if dry_run:
        log.info("  [DRY RUN] Would migrate logo.")
        return False, logo_url

    try:
        img_data, ext = download_image(logo_url)
        restaurant_name = restaurant_doc.get("restaurantName", "unknown")
        key = f"{DO_BASE_FOLDER}/{slugify(restaurant_name)}/logo{ext}"
        new_url = upload_to_spaces(spaces_client, img_data, key, ext)
        log.info(f"  ✓ Logo uploaded → {new_url}")
        return True, new_url
    except Exception as exc:
        log.error(f"  ✗ Error migrating logo: {exc}")
        return False, logo_url


def migrate_restaurant(restaurant_doc: dict, dry_run: bool = False) -> list[UpdateOne]:
    spaces_client   = get_spaces_client()
    restaurant_name = restaurant_doc.get("restaurantName", "unknown")
    bulk_ops        = []

    log.info(f"\n{'='*60}")
    log.info(f"Restaurant: {restaurant_name}")
    log.info(f"{'='*60}")

    # ── Migrate logo ───────────────────────────────────────────────────────────
    logo_changed, new_logo = migrate_restaurant_logo(
        spaces_client, restaurant_doc, dry_run=dry_run
    )

    # ── Migrate dish images ────────────────────────────────────────────────────
    categories    = restaurant_doc.get("categories", [])
    cats_changed  = False

    for cat in categories:
        category_name = cat.get("categoryName", "unknown").strip()
        log.info(f"\n  Category: {category_name}")

        for dish in cat.get("dishes", []):
            dish_name = dish.get("dishName", "unknown").strip()
            log.info(f"    Dish: {dish_name}")

            changed, updated_sis = migrate_serving_infos(
                spaces_client,
                dish.get("servingInfos", []),
                restaurant_name,
                category_name,
                dish_name,
                dry_run=dry_run,
            )
            if changed:
                dish["servingInfos"] = updated_sis
                cats_changed = True

        # NOTE: Baskin-Robbins data has no subCategories in the current dataset,
        # but the block below handles them gracefully if they appear in the future.
        for subcat in cat.get("subCategories", []):
            subcat_name = subcat.get("subCategoryName", "unknown").strip()
            log.info(f"\n    SubCategory: {subcat_name}")

            for dish in subcat.get("dishes", []):
                dish_name = dish.get("dishName", "unknown").strip()
                log.info(f"      Dish: {dish_name}")

                changed, updated_sis = migrate_serving_infos(
                    spaces_client,
                    dish.get("servingInfos", []),
                    restaurant_name,
                    category_name,
                    dish_name,
                    dry_run=dry_run,
                )
                if changed:
                    dish["servingInfos"] = updated_sis
                    cats_changed = True

    # ── Build bulk write operation if anything changed ────────────────────────
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


# ─── Runner ───────────────────────────────────────────────────────────────────

def run_migration(dry_run: bool = False):
    mongo_client = MongoClient(MONGO_URI)
    db           = mongo_client[DB_NAME]
    collection   = db[COLLECTION_NAME]

    query = {"restaurantName": TARGET_RESTAURANT}
    total = collection.count_documents(query)

    log.info(f"Target     : {TARGET_RESTAURANT}")
    log.info(f"Documents  : {total}")
    log.info(f"Dry run    : {dry_run}")
    log.info(f"{'='*60}")

    if total == 0:
        log.warning(f"No document found for '{TARGET_RESTAURANT}'. Check the name and DB.")
        mongo_client.close()
        return

    all_bulk_ops = []

    for doc in collection.find(query):
        try:
            ops = migrate_restaurant(doc, dry_run=dry_run)
            all_bulk_ops.extend(ops)
        except Exception as exc:
            log.error(f"Fatal error processing document {doc.get('_id')}: {exc}")

    if all_bulk_ops and not dry_run:
        result = collection.bulk_write(all_bulk_ops, ordered=False)
        log.info(f"\nDB updated: {result.modified_count} document(s) modified")
    elif dry_run:
        log.info("\n[DRY RUN] No changes written to DB.")

    log.info(f"\n{'='*60}")
    log.info("Migration complete.")
    log.info(f"{'='*60}")

    mongo_client.close()


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Migrate Baskin-Robbins images: Tillster CDN → DigitalOcean Spaces"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would happen without making any changes",
    )
    args = parser.parse_args()

    run_migration(dry_run=args.dry_run)