#!/usr/bin/env bash
# First argument: path to .puml — prints the output file stem PlantUML uses for -tpng/-tsvg/-txmi
# (the optional id on the @startuml line; otherwise the .puml basename without extension).
set -euo pipefail
puml="${1:?puml path}"
rest="$(head -1 "$puml" | tr -d '\r' | sed 's/^@[Ss]tartuml[[:space:]]*//')"
if [[ -z "${rest//[[:space:]]/}" ]]; then
  basename "$puml" .puml
else
  echo "${rest%%[[:space:]]*}"
fi
