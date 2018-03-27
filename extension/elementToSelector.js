this.elementToSelector = function elementToSelector(el) {
  let singletons = {BODY: true, HEAD: true};
  let parts = [];
  for (;;) {
    if (singletons[el.tagName]) {
      parts.unshift(el.tagName.toLowerCase());
      break;
    }
    if (el.id) {
      parts.unshift(`#${el.id}`);
      break;
    }
    let parent = el.parentNode;
    let position = Array.from(parent.childNodes).indexOf(el);
    parts.unshift(`*:nth-child(${position + 1})`);
    el = parent;
  }
  return parts.join(" > ");
};
