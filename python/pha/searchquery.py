"""
Tools for finding search/query-related pages in history
"""


def find_queries(archive):
    activities = archive.get_activity_by_url(like='%google.com%')
    actual = []
    for a in activities:
        q = a.query.get('q')
        if not q:
            continue
        q = q[0]
        actual.append((q, a))
    archive.set_all_activity_from_sources([a for q, a in actual])
    return actual
