#!/bin/zsh
set -e
cd "${0:A:h}"
printf '\nStarting Orekenoid at http://127.0.0.1:8080/\n\n'
npm run dev -- --open
