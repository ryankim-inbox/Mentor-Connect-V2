#!/usr/bin/env sh
# Verifies that the CI secret gate is fail-closed and immutable at its action boundary.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

WORKFLOW_ROOT="$ROOT" ruby <<'RUBY'
require "yaml"

root = ENV.fetch("WORKFLOW_ROOT")
workflow_path = File.join(root, ".github/workflows/secret-scan.yml")
workflow = YAML.load_file(workflow_path)
steps = workflow.fetch("jobs").fetch("secret-history-scan").fetch("steps")

checkout = steps.find { |step| step["uses"]&.start_with?("actions/checkout@") }
gitleaks = steps.find { |step| step["uses"]&.start_with?("gitleaks/gitleaks-action@") }

raise "checkout action is missing" unless checkout
raise "gitleaks action is missing" unless gitleaks

expected_checkout = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803"
expected_gitleaks = "gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e"

raise "checkout must use the approved immutable commit" unless checkout["uses"] == expected_checkout
raise "gitleaks must use the approved immutable commit" unless gitleaks["uses"] == expected_gitleaks

license = gitleaks.fetch("env")["GITLEAKS_LICENSE"]
raise "gitleaks license secret must be wired" unless license == "${{ secrets.GITLEAKS_LICENSE }}"

source = File.read(workflow_path)
raise "checkout version comment is missing" unless source.include?("#{expected_checkout} # v6.1.0")
raise "gitleaks version comment is missing" unless source.include?("#{expected_gitleaks} # v3.0.0")

puts "secret workflow policy validation passed"
RUBY
