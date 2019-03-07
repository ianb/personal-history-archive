import click
import os
import json
import sys


@click.group()
def cli():
    pass


@cli.command()
def install(native_name="browsinglab.connector"):
    """Install what is necessary for the browser connection"""
    # FIXME: support Windows
    manifest_path = os.path.abspath(os.path.join(__file__, "../../extension/manifest.json"))
    script_location = os.path.join(sys.prefix, "bin", "browser-connector")
    with open(manifest_path) as fp:
        manifest = json.load(fp)
    manifest_id = manifest["applications"]["gecko"]["id"]
    native_manifest = {
        "name": native_name,
        "description": "Saves information from the Browsing Lab extension",
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
