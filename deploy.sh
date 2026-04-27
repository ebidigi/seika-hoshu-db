#!/bin/bash

# 成果報酬チーム管理DB - デプロイスクリプト
# CSS/JSを埋め込んだ単一HTMLファイルを生成
#
# 使い方:
#   bash deploy.sh              → 自動でソースとデスト先を検出
#   bash deploy.sh /path/to/out → 出力先を指定

# ソースディレクトリ = このスクリプトがあるディレクトリ
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"

# 出力先: 引数があればそれを使う、なければホームディレクトリ
DEST_DIR="${1:-$HOME}"
DEST_FILE="$DEST_DIR/seika_hoshu_db.html"

echo "ソース: $SOURCE_DIR"
echo "出力先: $DEST_FILE"

python3 - "$SOURCE_DIR" "$DEST_FILE" << 'PYEOF'
import sys, os

source_dir = sys.argv[1]
dest_file = sys.argv[2]

with open(os.path.join(source_dir, 'index.html'), 'r') as f:
    html = f.read()

with open(os.path.join(source_dir, 'style.css'), 'r') as f:
    css = f.read()

with open(os.path.join(source_dir, 'app.js'), 'r') as f:
    js = f.read()

config_path = os.path.join(source_dir, 'config.js')
if os.path.exists(config_path):
    with open(config_path, 'r') as f:
        config_js = f.read()
else:
    print("WARNING: config.js が見つかりません。TURSO_CONFIG が未定義になります。")
    config_js = "// config.js not found"

# config.jsをインラインに置換
html = html.replace(
    '<script src="config.js"></script>',
    '<script>\n' + config_js + '\n</script>'
)

# CSSリンクをインラインスタイルに置換
html = html.replace(
    '<link rel="stylesheet" href="style.css">',
    '<style>\n' + css + '\n</style>'
)

# JSスクリプトタグをインラインに置換
html = html.replace(
    '<script src="app.js"></script>',
    '<script>\n' + js + '\n</script>'
)

with open(dest_file, 'w') as f:
    f.write(html)

print(f"\nデプロイ完了: {dest_file}")
print(f"ブラウザで確認: file://{dest_file}")

# === Admin画面のビルド ===
admin_path = os.path.join(source_dir, 'admin.html')
if os.path.exists(admin_path):
    dest_admin = dest_file.replace('seika_hoshu_db.html', 'seika_hoshu_admin.html')

    with open(admin_path, 'r') as f:
        admin_html = f.read()

    admin_css_path = os.path.join(source_dir, 'admin.css')
    admin_css = ''
    if os.path.exists(admin_css_path):
        with open(admin_css_path, 'r') as f:
            admin_css = f.read()

    admin_js_path = os.path.join(source_dir, 'admin.js')
    admin_js = ''
    if os.path.exists(admin_js_path):
        with open(admin_js_path, 'r') as f:
            admin_js = f.read()

    admin_html = admin_html.replace(
        '<script src="config.js"></script>',
        '<script>\n' + config_js + '\n</script>'
    )
    admin_html = admin_html.replace(
        '<link rel="stylesheet" href="style.css">',
        '<style>\n' + css + '\n</style>'
    )
    admin_html = admin_html.replace(
        '<link rel="stylesheet" href="admin.css">',
        '<style>\n' + admin_css + '\n</style>'
    )
    admin_html = admin_html.replace(
        '<script src="admin.js"></script>',
        '<script>\n' + admin_js + '\n</script>'
    )

    with open(dest_admin, 'w') as f:
        f.write(admin_html)

    print(f"Admin デプロイ完了: {dest_admin}")
    print(f"ブラウザで確認: file://{dest_admin}")
PYEOF
