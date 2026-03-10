#!/bin/bash

# 成果報酬チーム管理DB - デプロイスクリプト
# CSS/JSを埋め込んだ単一HTMLファイルを生成

SOURCE_DIR="/Users/ebineryota/code/成果報酬DB"
DEST_FILE="/Users/ebineryota/seika_hoshu_db.html"

# CSSとJSの内容を読み込み
CSS_CONTENT=$(cat "$SOURCE_DIR/style.css")
JS_CONTENT=$(cat "$SOURCE_DIR/app.js")

# index.htmlを読み込み、CSSリンクをインライン化、JSスクリプトをインライン化
sed \
  -e '/<link rel="stylesheet" href="style.css">/r /dev/stdin' \
  -e '/<link rel="stylesheet" href="style.css">/d' \
  -e '/<script src="app.js"><\/script>/r /dev/stdin' \
  -e '/<script src="app.js"><\/script>/d' \
  "$SOURCE_DIR/index.html" > /dev/null 2>&1

# より確実な方法: Pythonで結合
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

print(f"デプロイ完了: {dest_file}")
print(f"ブラウザで確認: file://{dest_file}")
PYEOF
