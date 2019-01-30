import click
import os
import json
import sys
import stat


@click.group()
def cli():
    pass


@cli.command()
def install():
    """Install what is necessary for the browser connection"""
    # FIXME: support Windows
    manifest_path = os.path.abspath(os.path.join(__file__, "../../extension/manifest.json"))
    script_location = os.path.join(sys.prefix, "bin", "browser-connector")
    native_name = "browsinglab.connector"
    with open(manifest_path) as fp:
        manifest = json.load(fp)
    manifest_id = manifest["applications"]["gecko"]["id"]
    with open(script_location, "w") as fp:
        # This script should support a Windows .BAT file
        fp.write("""\
#!%s
from browsinglab.connector import connect
connect()
""" % (sys.executable,))
    st = os.stat(script_location)
    os.chmod(script_location, st.st_mode | stat.S_IEXEC)
    native_manifest = {
        "name": native_name,
        "description": "Saves information from the personal-history-archive extension",
        "path": script_location,
        "type": "stdio",
        "allowed_extensions": [manifest_id]
    }
    if sys.platform == "darwin":
        filename = os.path.expanduser("~/Library/Application Support/Mozilla/NativeMessagingHosts/%s.json" % native_name)
    elif sys.platform.startswith("linux"):
        filename = os.path.expanduser("~/.mozilla/native-messaging-hosts/%s.json" % native_name)
    else:
        raise Exception("Not a supported platform")
    dir = os.path.dirname(filename)
    if not os.path.exists(dir):
        os.makedirs(dir)
    with open(filename, "wb") as fp:
        fp.write(json.dumps(native_manifest, indent=2).encode("UTF-8"))
    click.echo("Connector installed to:")
    click.secho("  %s" % filename, bold=True)
    click.echo("Script located in:")
    click.secho("  %s" % script_location, bold=True)
