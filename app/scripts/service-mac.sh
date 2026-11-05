#!/bin/bash
# تشغيل الأداة في الخلفية على الماك: تبدأ مع تسجيل الدخول وترجع لو طاحت
# الاستخدام: scripts/service-mac.sh install | restart | stop | uninstall | status
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.insta-analyzer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/insta-analyzer.log"
DOMAIN="gui/$(id -u)"
xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

case "${1:-install}" in
  install)
    NODE="$(command -v node || true)"
    [ -n "$NODE" ] || { echo "Node.js مو مثبت" >&2; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>--env-file-if-exists=.env</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
PL
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "تم التشغيل. السجل: $LOG"
    ;;
  restart) launchctl kickstart -k "$DOMAIN/$LABEL" ;;
  stop) launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true ;;
  uninstall) launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "انشال التشغيل التلقائي. بياناتك باقية في $DIR/data" ;;
  status) launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -m2 -E "^\s*(state|pid) =" || echo "مو شغالة" ;;
  *) echo "الاستخدام: $0 install | restart | stop | uninstall | status" >&2; exit 1 ;;
esac
