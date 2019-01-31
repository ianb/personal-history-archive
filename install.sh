#!/usr/bin/env bash

python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -e .
./.venv/bin/pip install -r ./dev-requirements.txt
if [[ ! -e blab ]] ; then
  ln -s ./.venv/bin/blab .
fi
