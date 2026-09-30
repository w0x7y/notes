#!/usr/bin/env bash
# Source this before build/test/run. Only the experimental checkout uses it.
export PKG_CONFIG_PATH="/home/idan/.cache/notes-gtk4-experiment/sysroot/usr/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export LD_LIBRARY_PATH="/home/idan/.cache/notes-gtk4-experiment/sysroot/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
