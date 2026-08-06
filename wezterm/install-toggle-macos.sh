#!/bin/bash
# macOS-only: generate + install the "Toggle WezTerm" Quick Action so it can
# be bound to a global hotkey in System Settings -> Services. Nothing is
# installed and nothing runs in the background — the workflow is a thin
# Run Shell Script wrapper around:
#   /usr/bin/osascript <this repo>/toggle-wezterm.applescript
# Editing the repo AppleScript takes effect immediately (no reinstall).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WF_DIR="$HOME/Library/Services/Toggle WezTerm.workflow"
APPLESCRIPT="$SCRIPT_DIR/toggle-wezterm.applescript"

if [ "$(uname)" != "Darwin" ]; then
    echo "Error: this installer is macOS-only."
    echo "  See the Readme for Linux/Windows hotkey adapter notes."
    exit 1
fi

if [ ! -f "$APPLESCRIPT" ]; then
    echo "Error: $APPLESCRIPT not found."
    exit 1
fi

# Wrapper command baked into the workflow (absolute path — re-run this
# script if the repo ever moves).
WRAPPER="/usr/bin/osascript \"$APPLESCRIPT\""
# XML-escape & < > for embedding in the plist
WRAPPER_ESCAPED="$(printf '%s' "$WRAPPER" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"

# Idempotent regenerate
rm -rf "$WF_DIR"
mkdir -p "$WF_DIR/Contents"

# Info.plist — service registration.
# NOTE: no NSRequiredContext key (it would restrict the service to Finder).
cat > "$WF_DIR/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>Toggle WezTerm</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSSendTypes</key>
			<array/>
			<key>NSReturnTypes</key>
			<array/>
		</dict>
	</array>
</dict>
</plist>
EOF

# document.wflow — single Run Shell Script action. Redundant legacy + modern
# workflowMetaData key sets maximize cross-macOS-version registration.
UUID1="$(uuidgen)"
UUID2="$(uuidgen)"
UUID3="$(uuidgen)"

cat > "$WF_DIR/Contents/document.wflow" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>$WRAPPER_ESCAPED</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/sh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<false/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>$UUID1</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>$UUID2</string>
				<key>UUID</key>
				<string>$UUID3</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
				</dict>
				<key>isViewVisible</key>
				<false/>
				<key>location</key>
				<string>309.000000:316.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<false/>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>processesInput</key>
		<false/>
		<key>presentationMode</key>
		<integer>6</integer>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useActionInput</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
EOF

# Validate the generated plists
plutil -lint "$WF_DIR/Contents/Info.plist" > /dev/null
plutil -lint "$WF_DIR/Contents/document.wflow" > /dev/null

# Refresh the services database (best effort)
/System/Library/CoreServices/pbs -update 2> /dev/null || true

echo "Installed: $WF_DIR"
echo ""
echo "Manual step (one-time, per machine):"
echo "  System Settings -> Keyboard -> Keyboard Shortcuts... -> Services"
echo "  -> General -> \"Toggle WezTerm\" -> assign ctrl+\` (control + backtick)"
echo ""
echo "On the first hotkey press, macOS will ask to allow controlling"
echo "System Events — click OK (one-time consent)."
echo ""
echo "If the service doesn't appear in System Settings, re-run:"
echo "  /System/Library/CoreServices/pbs -update"
echo "then log out and back in."
