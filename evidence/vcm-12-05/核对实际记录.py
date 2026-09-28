import json, hashlib, re
from pathlib import Path

base = Path(__file__).parent
path = base / '订单规则-实际请求记录.json'
raw = path.read_bytes()
data = json.loads(raw)
runs = [x['run'] for x in data['attempts']]
assert len(runs) == 7
assert all(x['transportError'] is None for x in data['attempts'])
assert all('error' not in x for x in runs)
bodies = [json.loads(x['request']['requestBody']) for x in runs]
assert all(len(b['messages']) == 2 for b in bodies)
assert all(b['model'] == 'qwen-flash' and b['temperature'] == 0 and b['enable_thinking'] is False for b in bodies)
assert all(x['rawAnswer'] == x['request']['responseMessage']['content'] for x in runs)
assert all(json.loads(x['rawAnswer']) == x['answer'] for x in runs)
rule = data['ruleEvents'][0]['rule']['text']
for i in range(3):
    plain, saved = bodies[i], json.loads(json.dumps(bodies[i+3]))
    assert saved['messages'][1]['content'] == plain['messages'][1]['content'] + '\n\n经人确认的业务规则：\n' + rule
    saved['messages'][1]['content'] = plain['messages'][1]['content']
    assert saved == plain
assert bodies[0] == bodies[6]
assert runs[6]['ruleSnapshot'] is None and rule not in runs[6]['request']['requestBody']
assert data['ruleAtExport']['enabled'] is False
assert [x['action'] for x in data['ruleEvents']] == ['save', 'disable']
assert [x['answer']['sku'] for x in runs] == [None, None, 'BL01', 'BL07', None, 'BL01', None]
assert not re.search(r'Bearer\s+|sk-[A-Za-z0-9_\-.]{12,}', raw.decode('utf-8'))
report = {'rawFile': path.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
          'utf16Length': len(raw.decode('utf-8').encode('utf-16-le'))//2,
          'allChecksPassed': True, 'actualExecutionCommit': 'c5603c94a1abfb53a1be0820feab7922c360cb5c',
          'actualModelCalls': 7, 'messageCounts': [len(x['messages']) for x in bodies],
          'comparisonOnlyRuleChanged': True, 'withdrawalInputEqualsInitialInput': True,
          'requests': [{'id':x['id'],'order':x['order']['id'],'ruleMode':x['ruleMode'],
                       'sku':x['answer']['sku'],'reason':x['answer']['reason'],'usage':x['request']['usage'],
                       'durationMs':x['request']['durationMs']} for x in runs]}
(base/'实际记录核对.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='requests'},ensure_ascii=False))
