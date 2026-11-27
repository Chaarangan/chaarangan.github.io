# Only needed to preview the site locally (bundle exec jekyll serve).
# GitHub Pages builds from this same gem server-side; nothing here is deployed.
source "https://rubygems.org"

gem "github-pages", group: :jekyll_plugins
gem "webrick"

# Ruby 3.4 removed these from the default gems. GitHub Pages still runs an older
# Ruby where they are bundled, so this block only matters for local preview.
gem "csv"
gem "base64"
gem "bigdecimal"
gem "logger"
gem "ostruct"
