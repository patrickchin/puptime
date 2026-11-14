# Exercise Fastfile Ruby paths from Fastlane's CWD without loading its gem,
# authenticating, executing sh, or submitting metadata/builds.
require "json"

$puptime_test_lanes = {}
def default_platform(_); end
def desc(_); end
def platform(_, &block); block.call; end
def private_lane(_); end
def lane(name, &block); $puptime_test_lanes[name] = block; end
def connect_api_key; {}; end
def sh(*args); $puptime_test_command = args; end
def deliver(**options); $puptime_test_delivery = options; end
module UI
  def self.user_error!(message); raise message; end
end

root = File.expand_path("..", __dir__)
fastfile = File.join(root, "fastlane/Fastfile")
eval(File.read(fastfile), TOPLEVEL_BINDING, fastfile)
ENV["APP_STORE_BUILD_NUMBER"] = "123"
ENV["APP_STORE_IPA_PATH"] = "output/candidate with spaces.ipa"
ENV["APP_REVIEW_EMAIL"] = "review@example.invalid"
ENV["APP_REVIEW_PHONE"] = "+10000000000"
Dir.chdir(File.join(root, "fastlane")) { $puptime_test_lanes.fetch(:submit).call }

expected = ["python3", File.join(root, "scripts/check-store-audio.py"),
            File.join(root, "output/candidate with spaces.ipa"),
            "--ios-version", PUPTIME_APP_VERSION, "--ios-build", "123"]
raise "Preflight paths/arguments changed" unless $puptime_test_command == expected
raise "Preflight script missing" unless File.file?($puptime_test_command[1])
notes = File.read(File.join(root, "fastlane/metadata/review_information/notes.txt"))
raise "Review notes path changed" unless $puptime_test_delivery[:app_review_information][:notes] == notes
raise "Unexpected automatic release" unless $puptime_test_delivery[:automatic_release] == false
raise "Unexpected blanket declarations" if $puptime_test_delivery.key?(:submission_information)
puts "Fastfile preflight/notes paths resolve from Fastlane CWD; external actions remained stubbed."
