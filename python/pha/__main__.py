from . import Archive

if __name__ == "__main__":
    import sys
    archive = Archive.default_location()
    print("Archive:", archive)
    if sys.argv[1:]:
        history = archive.get_history(sys.argv[1])
        page = history.page
        print("History:", history, history.visits)
        print("Page:", page)
        print("HTML:\n", page.html)
