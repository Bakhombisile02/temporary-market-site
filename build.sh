#!/bin/bash
set -e # Exit on error

# Change to the 'site' directory
cd site

# Install Ruby dependencies
bundle install

# Build the Jekyll site using Bundler
bundle exec jekyll build