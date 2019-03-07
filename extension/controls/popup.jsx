/* globals React, ReactDOM */

const model = {
  selectContainers: false,
  selectedContainers: new Set(),
  track: false,
  archive: {
    title: null,
    path: null,
  },
};

class Interface extends React.Component {
  render() {
    return <div>
      <ArchiveSelector archive={this.props.archive} />
      <GeneralControl track={this.props.track} />
      <ContainerSelector
       containers={this.props.containers}
       selectContainers={this.props.selectContainers}
       selectedContainers={this.props.selectedContainers}
       />
    </div>;
  }
}

class ArchiveSelector extends React.Component {
  render() {
    return <div>
      <label>
        <div>Archive title:</div>
        <div>
          <input type="text" value={this.props.archive.title}
           style={{width: "100%"}}
           onChange={this.changeArchiveTitle.bind(this)}
           placeholder="Something for your reference" />
        </div>
      </label>
      <label>
        <div>Archive path:</div>
        <div>
          <input type="text" value={this.props.archive.path}
          style={{width: "100%"}}
          onChange={this.changeArchivePath.bind(this)}
          placeholder="A path on disk" />
        </div>
      </label>
    </div>;
  }

  changeArchiveTitle(event) {
    let title = event.target.value;
    model.archive.title = title;
    render();
  }

  changeArchivePath(event) {
    let path = event.target.value;
    model.archive.path = path;
    render();
  }
}

class GeneralControl extends React.Component {
  render() {
    return <div>
      <label>
        Track information in this browser:
        <input type="checkbox" checked={this.props.track} onChange={this.onCheck.bind(this)} />
      </label>
    </div>;
  }

  onCheck(event) {
    model.track = event.target.checked;
    browser.runtime.sendMessage({
      type: "track",
      value: model.track,
    });
    render();
  }
}

class ContainerSelector extends React.Component {
  render() {
    return <div>
      <ul>
        <li><label>
          <input type="checkbox" checked={this.props.selectContainers}
           onChange={this.onCheckSelectContainers.bind(this)} />
          Track only specific containers
        </label></li>
        { this.props.containers.map(c => {
          return <li key={c.name}><label>
            <input type="checkbox" checked={this.props.selectedContainers.has(c.name)}
             disabled={!this.props.selectContainers} onChange={this.onCheckContainer.bind(this, c)} />
             <img src={c.iconUrl} /> <span style={{backgroundColor: c.colorCode}}>{c.name}</span>
          </label></li>;
        })}
      </ul>
    </div>;
  }

  onCheckSelectContainers(event) {
    model.selectContainers = !!event.target.checked;
    sendModel();
    render();
  }

  onCheckContainer(c, event) {
    if (event.target.checked) {
      model.selectedContainers.add(c.name);
    } else {
      model.selectedContainers.delete(c.name);
    }
    sendModel();
    render();
  }
}

function sendModel() {
  browser.runtime.sendMessage({
    type: "updateArchive",
    selectContainers: model.selectContainers,
    selectedContainers: Array.from(model.selectedContainers.values()),
    track: model.track,
    archive: model.archive,
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type !== "updateArchive") {
    return;
  }
  if ("selectContainers" in message) {
    model.selectContainers = message.selectContainers;
  }
  if ("selectedContainers" in message) {
    model.selectedContainers = new Set(message.selectedContainers);
  }
  if ("track" in message) {
    model.track = !!message.track;
  }
  if ("archive" in message) {
    model.archive = message.archive;
  }
  render();
});

browser.runtime.sendMessage({
  type: "requestUpdateArchive",
});

async function render() {
  let containers = await browser.contextualIdentities.query({});
  let page = <Interface containers={containers} {...model} />;
  ReactDOM.render(page, document.getElementById("container"));
}

render();
