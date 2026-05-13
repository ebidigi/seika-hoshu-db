#!/usr/bin/env python3
"""
Turso → NeonDB 동기화 스크립트

사용법:
  python3 turso/sync_to_neon.py

Turso(seika-hoshu-db)의 최신 데이터를 NeonDB(digiman-internal-db)에 동기화.
ON CONFLICT DO NOTHING으로 중복은 자동 스킵.
"""

import json
import urllib.request
import psycopg2

# === 접속 정보 ===
TURSO_URL = 'https://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io'
TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzMxMDE2NTgsImlkIjoiMDE5Y2Q1MTgtMTYwMS03NDUzLTg2NTktZDdhZGRhNDY2ZDJhIiwicmlkIjoiNDQ4MTQ4ODAtZDdlZS00NTBlLWFjYTgtMDczYzI2Njk2MDhlIn0.YuB6UZYWy9iE1MxrQe4oKX7OyPjAqtT12RRZeaOzjSueyqR9_HbZUPvmPhiK8fQi-5a3iK3CqkG4lLhVrRn1Cg'
NEON_CONN = 'postgresql://neondb_owner:npg_h3jC7HmxczeO@ep-late-water-a1ig90q7-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'

# === Turso member_name → NeonDB sales_rep_id ===
MEMBER_MAP = {
    '三善': 'ab2ce50e-93ee-464d-8e70-ec94d1db4082',
    '中村た': '2cf4f83a-bf09-47e4-aa49-577dc9b5b047',
    '坪井': 'ffe30cb6-fb7a-4e50-87b7-16c2853e6295',
    '堀切': '83e8b5ad-d254-4133-a7c7-984ddde70a73',
    '宮城': '84b4cd99-0c13-4d64-a85a-4851a6550b99',
    '山本': '4b6ed160-8ceb-4b88-b0dd-1c183ec4e5bb',
    '村上': '0e17aa9e-bfd2-4022-bfd0-74543cdc4f43',
    '村松': '449c65ad-d2e6-4303-9318-96c889c1d489',
    '松居': '093fb350-e69b-485c-bacf-f3e63128c652',
    '池田': '55c799fb-26f7-468f-8d7c-7f04a3ab2c9a',
    '清水': '3e2963e4-421d-4d77-8ad5-a5be65bb9870',
    '田中か': 'cf929661-38e7-4ab8-8678-8263aa15ce70',
    '田中颯汰': '5e088dc2-736c-4334-b873-88b919c47f95',
    '美除': '3e22214c-61fb-4f66-aad6-4e0ad48ff3f7',
    '菊池': 'c94627bc-0813-4698-8a11-4a1a648c8973',
    '轟': '4c76e802-8ff6-4ebd-944e-ed9806b53d3a',
    '辻森': '432adb95-9a5f-434c-aff7-6f78be99099e',
    '野上': '59be86ea-8a90-4901-b0e1-9e97e3842b8d',
    '野口': '39b93736-c0c6-496f-bf79-fa461d7ac88e',
}

# === Turso project_name → NeonDB project_id ===
PROJECT_MAP = {
    '&IT': '8b61f545-d95a-4887-87de-b73d376430dc',
    '4D-Stretch': 'd894407e-cc84-46dc-97d9-fa262dca44d0',
    'CC東京IT': '8b4b51df-5fb8-400c-af48-49ef8d4bcbe8',
    'Cloudbase': 'd30a3f7c-c06b-4d87-a6eb-b05cec317676',
    'DOMO': '411d6feb-ef31-46c3-9233-163f88935717',
    'FOLK': '8931d937-5685-44ad-bd2f-37e3fe267ac4',
    'HRMOS': 'd1dfcebf-cb2e-4ce4-8dfe-c7ef07234475',
    'HRMOSタレマネ': '9db97382-8f81-4ec2-8caf-94bd20121fc1',
    'Hajimari': '71eeb1a5-10f5-463e-8541-f4102f1bc042',
    'KOSKA': '176608fd-608a-4e41-8b33-7ba5ced977ec',
    'Kamameshi': 'c4a06736-72e4-4dda-92b5-cf1ec74d3a49',
    'MNTSQ': '176bc680-8e2b-47eb-9451-a592e306e293',
    'ONEPLAT': '5b35452a-71b5-4058-8320-13372490bba4',
    'PNゼロワン': '9839410d-0e71-4f25-b0e2-5f3d59e07331',
    'SmartHR': 'c427d95b-ff16-46d1-aa0c-174c166b6726',
    'Swish': '8e1deece-2d3b-4596-bc70-90a27768e339',
    'TLBライフ': 'c2d631cd-abea-443a-82ab-b15c3a7684d1',
    'TOKIUM': '2719f095-e06e-41e3-a207-6e45bedb4b68',
    'YOUTRUST': '5f603d16-b66f-4fa4-8b17-8eed7b8a0243',
    'YOUTRUST(SDR)': 'a56a55a9-c9f1-4d4a-aef9-30af89b8fd16',
    'mento': 'd08a3b03-3600-44c1-88e1-18b15126a7c5',
    'takumi': '1dc0a264-7c01-432c-af1e-ee37b5be7f6f',
    'talentbook': '891529fe-f8e2-4228-9185-a30edfc2d8ad',
    'アスマーク': '3a883ba9-61f5-47ea-905d-05001f862484',
    'エコモ': '37cc35fd-3f9f-416f-9fea-ccf1fc205e48',
    'エコモ2': 'ba5ccba5-ee62-46f9-9873-69f9c7e20ece',
    'カオナビ': '6794b598-5d9f-4a1c-a5d6-72ed4b00d2e5',
    'カミナシ': 'c6068a6c-362e-4ba8-b90a-24e8203f66b4',
    'ソーシャルインテリア': '6428c88a-36e6-46d9-9d1c-a723fcfd61ba',
    'パシフィックネット': 'b7377733-0510-4bd8-8e9e-e45d6f8896dc',
    'パンタレイ': 'fbd1ed48-2b50-4d7c-ae60-89fb9a278806',
    'ファイナンスプロパートナーズ': '024057c5-e6d4-4337-a2aa-895d98fabaf9',
    'リンクアンドモチベーション': 'c7be2b9c-98fc-42cf-aa6c-ff4b826e8ee4',
    '商Akinai': 'e864223c-91fc-4132-a5a1-e61d9c7cb6a3',
    '日本経済新聞社(Credly)': '1a3a8a66-76aa-4fa5-b63f-a474d7a69305',
    '日本経済新聞社(SDR)': 'fc62edd9-c92a-47aa-90a9-a54d91cda63e',
    '株式会社DigiMan': '79042642-66e4-4b02-9236-0fc7927690de',
    '求人ボックス': '3a43dc64-811b-4a03-8900-c7bbed3b6b26',
    '東京ITスクール': 'e5d85187-a72c-4061-9849-6c127380d2fc',
}


def query_turso(sql):
    req = urllib.request.Request(TURSO_URL,
        data=json.dumps({"statements": [{"q": sql}]}).encode(),
        headers={'Authorization': f'Bearer {TURSO_TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    result = data[0]
    if 'error' in result:
        raise Exception(result['error'])
    cols = result.get('results', {}).get('columns', [])
    rows = result.get('results', {}).get('rows', [])
    return [dict(zip(cols, row)) for row in rows]


def sync():
    print('=== Turso → NeonDB 동기화 시작 ===\n')

    # 1. Turso에서 데이터 가져오기
    perf = query_turso("SELECT member_name, project_name, input_date, call_hours, call_count, pr_count, appointment_count, appointment_amount, data_source FROM performance_rawdata ORDER BY input_date")
    assign = query_turso("SELECT member_name, project_name, year_month, rank, project_type, pm_name, cap_count, cap_amount, target_count, sheet_url FROM project_member_assignments ORDER BY year_month")
    pl = query_turso("SELECT year_month, revenue, cost_total, gross_profit, memo FROM team_monthly_pl ORDER BY year_month")

    print(f'Turso 데이터: perf={len(perf)}건, assign={len(assign)}건, pl={len(pl)}건\n')

    # 2. NeonDB 접속
    conn = psycopg2.connect(NEON_CONN)
    cur = conn.cursor()

    # 3. performance_rawdata
    success, skip, errors = 0, 0, 0
    for r in perf:
        rep_id = MEMBER_MAP.get(r['member_name'])
        proj_id = PROJECT_MAP.get(r['project_name'])
        if not rep_id or not proj_id:
            skip += 1
            continue
        try:
            cur.execute(
                """INSERT INTO performance_rawdata
                   (sales_rep_id, project_id, input_date, call_hours, call_count, pr_count, appointment_count, appointment_amount, data_source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (sales_rep_id, project_id, input_date) DO UPDATE SET
                     call_hours = EXCLUDED.call_hours,
                     call_count = EXCLUDED.call_count,
                     pr_count = EXCLUDED.pr_count,
                     appointment_count = EXCLUDED.appointment_count,
                     appointment_amount = EXCLUDED.appointment_amount,
                     modified_at = NOW()""",
                (rep_id, proj_id, r['input_date'], r['call_hours'] or 0, r['call_count'] or 0,
                 r['pr_count'] or 0, r['appointment_count'] or 0, r['appointment_amount'] or 0,
                 r.get('data_source', 'seika'))
            )
            success += 1
        except Exception as e:
            errors += 1
            conn.rollback()
    conn.commit()
    print(f'performance_rawdata: {success}건 동기화, {skip}건 스킵, {errors}건 에러')

    # 4. project_member_assignments
    success2, skip2, errors2 = 0, 0, 0
    for r in assign:
        rep_id = MEMBER_MAP.get(r['member_name'])
        proj_id = PROJECT_MAP.get(r['project_name'])
        if not rep_id or not proj_id:
            skip2 += 1
            continue
        ym = r['year_month'] + '-01' if len(r['year_month']) == 7 else r['year_month']
        try:
            cur.execute(
                """INSERT INTO project_member_assignments
                   (sales_rep_id, project_id, year_month, rank, project_type, pm_name, cap_count, cap_amount, target_count, sheet_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (sales_rep_id, project_id, year_month) DO UPDATE SET
                     rank = EXCLUDED.rank, pm_name = EXCLUDED.pm_name,
                     cap_count = EXCLUDED.cap_count, cap_amount = EXCLUDED.cap_amount,
                     target_count = EXCLUDED.target_count, modified_at = NOW()""",
                (rep_id, proj_id, ym, r.get('rank', 'C'), r.get('project_type', '成果報酬'),
                 r.get('pm_name'), r.get('cap_count') or 0, r.get('cap_amount') or 0,
                 r.get('target_count') or 0, r.get('sheet_url'))
            )
            success2 += 1
        except Exception as e:
            errors2 += 1
            conn.rollback()
    conn.commit()
    print(f'project_member_assignments: {success2}건 동기화, {skip2}건 스킵, {errors2}건 에러')

    # 5. team_monthly_pl
    success3, errors3 = 0, 0
    for r in pl:
        ym = r['year_month'] + '-01' if len(r['year_month']) == 7 else r['year_month']
        try:
            cur.execute(
                """INSERT INTO team_monthly_pl (year_month, revenue, cost_total, gross_profit, memo)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (year_month) DO UPDATE SET
                     revenue = EXCLUDED.revenue, cost_total = EXCLUDED.cost_total,
                     gross_profit = EXCLUDED.gross_profit, modified_at = NOW()""",
                (ym, r.get('revenue') or 0, r.get('cost_total') or 0, r.get('gross_profit') or 0, r.get('memo'))
            )
            success3 += 1
        except Exception as e:
            errors3 += 1
            conn.rollback()
    conn.commit()
    print(f'team_monthly_pl: {success3}건 동기화, {errors3}건 에러')

    # 6. 확인
    cur.execute("SELECT COUNT(*) FROM performance_rawdata")
    print(f'\nNeonDB 현재 건수:')
    print(f'  performance_rawdata: {cur.fetchone()[0]}건')
    cur.execute("SELECT COUNT(*) FROM project_member_assignments")
    print(f'  project_member_assignments: {cur.fetchone()[0]}건')
    cur.execute("SELECT COUNT(*) FROM team_monthly_pl")
    print(f'  team_monthly_pl: {cur.fetchone()[0]}건')

    cur.close()
    conn.close()
    print('\n=== 동기화 완료 ===')


if __name__ == '__main__':
    sync()
