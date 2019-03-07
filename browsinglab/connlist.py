"""
This handles keeping all the archives on disk registered
"""
import os


DIR_LOCATION = os.path.expanduser("~/.browsinglab")
LOCATIONS = os.path.join(DIR_LOCATION, "locations.txt")

if not os.path.exists(DIR_LOCATION):
    os.makedirs(DIR_LOCATION)


def get_locations():
    if not os.path.exists(LOCATIONS):
        return []
    with open(LOCATIONS) as fp:
        lines = fp.readlines()
    locations = [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]
    locations = [l for l in locations if os.path.isdir(l)]
    return locations


def list_archives():
    result = []
    for l in get_locations():
        title = None
        title_path = os.path.join(l, "title.txt")
        if os.path.exists(title_path):
            with open(title_path) as fp:
                title = fp.read().strip() or None
        result.append({
            "path": l,
            "title": title,
        });
    return result


def add_location(l):
    l = os.path.abspath(l)
    if l in get_locations():
        return
    with open(LOCATIONS, "a") as fp:
        fp.write("%s\n" % l)
