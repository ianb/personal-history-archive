"""
Tools for use in Jupyter Notebooks, especially display_html()
"""
import base64
from IPython.core.display import display, HTML
from cgi import escape as html_escape
import lxml
import time
import os
import shutil
from urllib.request import urlopen


def make_data_url(content_type, content):
    encoded = base64.b64encode(content.encode('UTF-8')).decode('ASCII')
    return 'data:%s;base64,%s' % (content_type, encoded.replace('\n', ''))

def display_html(html_page, header='', footer='', height="12em", title=None, link=None, link_title=None):
    """
    Display an HTML page inline in a Jupyter notebook.

    The page will go in an iframe. The header and footer are optional extra HTML. The title, link, and link_title are all used as part of a header.
    """
    if isinstance(html_page, lxml.etree.ElementBase):
        html_page = lxml.html.tostring(html_page)
    if isinstance(html_page, bytes):
        html_page = html_page.decode("UTF-8")
    literal_data = make_data_url("text/html", html_page)
    if title:
        if link and not link_title:
            title = '<strong><a href="%s" target=_blank>%s</a></strong>' % (
              html_escape(title), html_escape(link))
        elif link:
            title = '<strong>%s</strong> <a href="%s" target=_blank>%s</a>' % (
              html_escape(title), html_escape(link), html_escape(link_title))
        else:
            title = '<strong>%s</strong>' % html_escape(title)
        header = title + "\n" + header
    if header:
        header = '<div>%s</div>' % header
    if footer:
        footer = '<div>%s</div>' % footer
    html = '''
    <div>
      %s
      <iframe style="width: 100%%; height: %s; overflow: scroll" scrolling="yes" src="%s"></iframe>
      %s
    </div>
    ''' % (header, html_escape(height), literal_data, footer)
    display(HTML(html))

chooser_id = int(time.time())

def display_chooser(links, height="12em"):
    display(HTML(display_chooser_html(links, height=height)))

def display_chooser_html(links, height="12em"):
    global chooser_id
    if not links:
        return '<div>Nothing to choose from</div>'
    chooser_id, my_id = chooser_id + 1, "chooser-%s" % chooser_id
    links_html = []
    for link in links:
        if isinstance(link, str):
            link = {"src": link}
        if not link.get("title"):
            link["title"] = link["src"]
        links_html.append('''
        <button onclick="document.querySelector('#%s iframe').src = %s">%s</button>
        ''' % (
            my_id,
            html_escape(repr(link["src"])),
            html_escape(link["title"]),
        ))
    return '''\
<div id="%(id)s">
  %(links)s
  <iframe style="width: 100%% ; height: %(height)s;  overflow: scroll" scrolling="yes"></iframe>
</div>
''' % dict(
        id=my_id,
        links=' '.join(links_html),
        height=height,
    )


def lazyget(url, filename):
    if os.path.exists(filename):
        if os.path.getsize(filename):
            print("File", filename, "already exists")
            return
        else:
            print("File", filename, "is empty; overwriting")
    dirname = os.path.dirname(filename)
    if not os.path.exists(dirname):
        print("Creating directory %s/" % dirname)
        os.makedirs(dirname)
    with urlopen(url) as resp:
        try:
            length = int(resp.getheader("Content-Length")) // 1000
            length = "%skb" % length
        except:
            length = "unknown size"
        print("Reading %s into %s..." % (length, filename), end="")
        with open(filename, "wb") as fp:
            shutil.copyfileobj(resp, fp)
        print(" done.")
