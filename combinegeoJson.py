import json
from collections import Counter
from pathlib import Path

# Define the paths to the GeoJSON files
geo_files = [
    "geo locations/erbil_places.geojson",
    "geo locations/baghdad_places.geojson",
    "geo locations/slemani_places.geojson"
]

# Step 1: Load all files and collect all features
all_features = []
category_counter = Counter()

print("Loading GeoJSON files...")
for file_path in geo_files:
    print(f"  Processing {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        features = data.get('features', [])
        all_features.extend(features)
        
        # Count categories while loading
        for feature in features:
            category = feature.get('properties', {}).get('categories', {}).get('primary')
            if category:
                category_counter[category] += 1

print(f"\nTotal features loaded: {len(all_features)}")
print(f"Total unique categories: {len(category_counter)}")

# Step 2: Get top 10 most common categories
top_10_categories = [cat for cat, count in category_counter.most_common(10)]
print(f"\nTop 10 categories:")
for i, (category, count) in enumerate(category_counter.most_common(10), 1):
    print(f"  {i}. {category}: {count} occurrences")

# Step 3: Filter features to only include top 10 categories
filtered_features = []
for feature in all_features:
    category = feature.get('properties', {}).get('categories', {}).get('primary')
    if category in top_10_categories:
        filtered_features.append(feature)

print(f"\nFiltered features: {len(filtered_features)} (from {len(all_features)} total)")

# Step 4: Create combined GeoJSON
combined_geojson = {
    "type": "FeatureCollection",
    "features": filtered_features
}

# Step 5: Save the combined GeoJSON
output_file = "geo locations/combined_places.geojson"
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(combined_geojson, f, ensure_ascii=False, indent=2)

print(f"\nCombined GeoJSON saved to: {output_file}")
print(f"Output contains {len(filtered_features)} features with top 10 categories.")

