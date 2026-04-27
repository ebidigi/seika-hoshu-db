"""
Vercel用ビルドスクリプト
環境変数からTurso接続情報を読み取り、単一HTMLファイルを生成
"""
import os
import sys

source_dir = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(source_dir, 'dist')
os.makedirs(out_dir, exist_ok=True)

# 環境変数からTurso設定を取得（Vercel環境変数 or ローカルconfig.js）
turso_url = os.environ.get('TURSO_URL', '')
turso_token = os.environ.get('TURSO_TOKEN', '')

if turso_url and turso_token:
    config_js = f"""const TURSO_CONFIG = {{
    url: '{turso_url}',
    authToken: '{turso_token}'
}};"""
    print(f"Turso設定: 環境変数から取得")
else:
    # ローカルのconfig.jsを使用
    config_path = os.path.join(source_dir, 'config.js')
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config_js = f.read()
        print(f"Turso設定: config.jsから取得")
    else:
        print("ERROR: TURSO_URL/TURSO_TOKEN環境変数もconfig.jsもありません")
        sys.exit(1)

# 共通ファイル読み込み
with open(os.path.join(source_dir, 'style.css'), 'r') as f:
    css = f.read()

# === メインダッシュボード ===
with open(os.path.join(source_dir, 'index.html'), 'r') as f:
    html = f.read()
with open(os.path.join(source_dir, 'app.js'), 'r') as f:
    js = f.read()

html = html.replace('<script src="config.js"></script>', '<script>\n' + config_js + '\n</script>')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="app.js"></script>', '<script>\n' + js + '\n</script>')

with open(os.path.join(out_dir, 'index.html'), 'w') as f:
    f.write(html)
print(f"ビルド完了: dist/index.html")

# === Admin画面 ===
admin_path = os.path.join(source_dir, 'admin.html')
if os.path.exists(admin_path):
    with open(admin_path, 'r') as f:
        admin_html = f.read()

    admin_css = ''
    admin_css_path = os.path.join(source_dir, 'admin.css')
    if os.path.exists(admin_css_path):
        with open(admin_css_path, 'r') as f:
            admin_css = f.read()

    admin_js = ''
    admin_js_path = os.path.join(source_dir, 'admin.js')
    if os.path.exists(admin_js_path):
        with open(admin_js_path, 'r') as f:
            admin_js = f.read()

    admin_html = admin_html.replace('<script src="config.js"></script>', '<script>\n' + config_js + '\n</script>')
    admin_html = admin_html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
    admin_html = admin_html.replace('<link rel="stylesheet" href="admin.css">', '<style>\n' + admin_css + '\n</style>')
    admin_html = admin_html.replace('<script src="admin.js"></script>', '<script>\n' + admin_js + '\n</script>')

    with open(os.path.join(out_dir, 'admin.html'), 'w') as f:
        f.write(admin_html)
    print(f"ビルド完了: dist/admin.html")
