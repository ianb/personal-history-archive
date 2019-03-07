/* globals backgroundOnMessage, buildSettings, communication, activityTracker, browserIdPromise, log */

this.controller = (function() {
  const exports = {};
  let tracker;
  let model = {
    selectContainers: false,
    selectedContainers: new Set(),
    track: false,
    archive: {
      title: null,
      path: null,
    }
  };

  const onInstalled = new Promise((resolve) => {
    browser.runtime.onInstalled.addListener(resolve);
  });

  async function init() {
    let { temporary } = await onInstalled;
    if (temporary) {
      if (!model.archive.path) {
        model.archive.path = buildSettings.temporaryArchiveLocation;
        model.track = true;
        openTracker();
      }
    }
  }

  backgroundOnMessage.register("updateArchive", (info) => {
    if (tracker) {
      if (model.track && !info.track) {
        closeTracker();
      } else if (model.archive.path !== info.archive.path) {
        closeTracker();
      }
    }
    model.selectContainers = info.selectContainers;
    model.selectedContainers = new Set(info.selectedContainers);
    model.track = info.track;
    model.archive = info.archive;
    if (model.track && model.archive.path) {
      openTracker();
    }
  });

  backgroundOnMessage.register("requestUpdateArchive", () => {
    browser.runtime.sendMessage({
      type: "updateArchive",
      selectContainers: model.selectContainers,
      selectedContainers: Array.from(model.selectedContainers.values()),
      track: model.track,
      archive: model.archive,
    });
  });

  function closeTracker() {
    tracker.uninit();
    tracker = null;
    communication.unset_active_archive();
  }

  async function openTracker() {
    await communication.set_active_archive(model.archive.path);
    await communication.set_archive_title(model.archive.title);
    tracker = new activityTracker.Tracker();
    tracker.init();
  }

  browserIdPromise.then(async () => {
    await init();
  }).catch((e) => {
    log.error("Error initializing:", String(e), e, e.stack);
  });

  return exports;
})();
