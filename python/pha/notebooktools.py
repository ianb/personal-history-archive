import base64
from IPython.core.display import display, HTML
from cgi import escape as html_escape
import lxml

def make_data_url(content_type, content):
    encoded = base64.b64encode(content.encode('UTF-8')).decode('ASCII')
    return 'data:%s;base64,%s' % (content_type, encoded.replace('\n', ''))

def display_html(html_page, header='', footer='', height="12em", title=None, link=None, link_title=None):
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
