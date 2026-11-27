# Local preview for chaarangan.github.io.
#
# GitHub Pages builds the deployed site itself from Gemfile (github-pages,
# Jekyll 3.9) with no CI. These targets are only for previewing changes on this
# machine, and they use Gemfile.local (Jekyll 4) because github-pages cannot
# resolve on Ruby 4.x -- see the comment at the top of Gemfile.local.
#
#   make serve    preview at http://localhost:4000 with live reload
#   make build    render the site into _site/
#   make check    run the repo's own consistency scripts
#   make clean    remove build output
#
# Everything this creates (.gems/, _site/, *.lock) is gitignored.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PORT ?= 4000
DEST ?= _site

# System Ruby on macOS is 2.6, too old for Jekyll 4, so prefer Homebrew's.
RUBY_BIN := $(shell for p in /opt/homebrew/opt/ruby/bin /usr/local/opt/ruby/bin; do [ -x "$$p/ruby" ] && echo "$$p" && break; done)

export GEM_HOME  := $(CURDIR)/.gems
export BUNDLE_GEMFILE := $(CURDIR)/Gemfile.local
export PATH := $(if $(RUBY_BIN),$(RUBY_BIN):,)$(CURDIR)/.gems/bin:$(PATH)

# Call bundle by absolute path rather than trusting PATH. make 3.81 (what ships
# with macOS) does not reliably hand the exported PATH to every recipe shell, and
# the fallback is /usr/bin/bundle on the 2.6 system Ruby, which fails to resolve
# anything here. Being explicit removes the ambiguity entirely.
BUNDLE := $(if $(RUBY_BIN),$(RUBY_BIN)/bundle,bundle)

STAMP  := .gems/.installed
JEKYLL := $(BUNDLE) exec jekyll

.PHONY: help setup serve build check medium clean distclean doctor

help:
	@echo "chaarangan.github.io -- local preview"
	@echo
	@echo "  make serve      preview at http://localhost:$(PORT) (live reload)"
	@echo "  make build      render into $(DEST)/"
	@echo "  make check      tag-page sync + live-stats dry run"
	@echo "  make medium POST=<slug>   build a paste-ready Medium bundle"
	@echo "  make clean      remove $(DEST)/ and the Jekyll cache"
	@echo "  make distclean  also remove the local gem install"
	@echo "  make doctor     show which Ruby and gems are in use"
	@echo
	@echo "Override the port with:  make serve PORT=4001"

# Gems install into ./.gems so nothing touches the system Ruby. The stamp keeps
# repeat runs instant; deleting .gems or editing Gemfile.local re-triggers it.
$(STAMP): Gemfile.local
	@if [ -z "$(RUBY_BIN)" ] && ! ruby -e 'exit(RUBY_VERSION.split(".")[0].to_i >= 3)' 2>/dev/null; then \
		echo "error: no Ruby 3+ found. Install one with:  brew install ruby"; exit 1; \
	fi
	@echo "==> installing gems into .gems (first run only)"
	@mkdir -p .gems
	@$(BUNDLE) install --quiet
	@touch $(STAMP)

setup: $(STAMP)
	@echo "==> ready. run 'make serve'"

serve: $(STAMP)
	@echo "==> http://localhost:$(PORT)  (ctrl-c to stop)"
	@$(JEKYLL) serve --port $(PORT) --livereload --destination $(DEST)

build: $(STAMP)
	@$(JEKYLL) build --destination $(DEST)
	@echo "==> built into $(DEST)/"

# The repo's own guards: tag stubs must match the tags used in _posts, and the
# live-stats markers in index.html must still be where update_stats.py expects.
check:
	@python3 scripts/sync_tag_pages.py --check
	@python3 scripts/update_stats.py --dry-run >/dev/null && echo "update_stats.py: markers OK"

# Medium retired its write API, so cross-posting is copy-paste. This renders the
# post's inline SVGs to PNG (Medium strips SVG) and emits a paste-ready page.
# Needs $(DEST)/ to be current, so it depends on build.
medium: build
	@test -n "$(POST)" || { echo "usage: make medium POST=<post-slug>"; exit 1; }
	@python3 scripts/medium_bundle.py $(POST)

clean:
	@rm -rf $(DEST) .jekyll-cache .jekyll-metadata
	@echo "==> removed $(DEST)/ and caches"

distclean: clean
	@rm -rf .gems Gemfile.local.lock
	@echo "==> removed local gem install"

doctor:
	@echo "ruby         : $(if $(RUBY_BIN),$(RUBY_BIN)/ruby,$$(command -v ruby)) ($$($(if $(RUBY_BIN),$(RUBY_BIN)/ruby,ruby) -v 2>/dev/null | cut -d' ' -f2))"
	@echo "GEM_HOME     : $(GEM_HOME)"
	@echo "BUNDLE_GEMFILE: $(BUNDLE_GEMFILE)"
	@if [ -f "$(STAMP)" ]; then $(JEKYLL) --version; else echo "jekyll: not installed -- run 'make setup'"; fi
	@echo
	@echo "note: GitHub Pages deploys with Gemfile (github-pages / Jekyll 3.9),"
	@echo "      not Gemfile.local. This is preview only."
