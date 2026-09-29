import hashlib
import json
from pathlib import Path

root = Path(__file__).parent
raw = (root / '浏览器实测-完整与停止.json').read_text(encoding='utf-8')
payload = json.loads(raw)
summaries = []
for index, attempt in enumerate(payload['attempts']):
    server = attempt['serverRecord']
    expected = 'completed' if index == 0 else 'stopped'
    assert attempt['state'] == server['state'] == expected
    client_events = [item['event'] for item in attempt['events']]
    server_events = [item['event'] for item in server['uiEvents']]
    assert client_events == server_events
    progress = [event['data']['stage'] for event in client_events if event['type'] == 'data-progress']
    assert progress == ['summary', 'questions', expected]
    assert sum(event['type'] == 'start' for event in client_events) == 1
    assert sum(event['type'] == 'finish' for event in client_events) == (1 if index == 0 else 0)
    if index == 1:
        assert client_events[-1]['type'] == 'abort'
        assert not any(event['type'] == 'text-end' and event['id'] == 'questions' for event in client_events)
    for message in [attempt['message'], server['finalMessage']]:
        parts = [part for part in message['parts'] if part['type'] == 'data-progress']
        assert len(parts) == 1 and parts[0]['data']['stage'] == expected
        assert message['metadata']['state'] == expected
    stages = []
    for stage in server['stages']:
        request = json.loads(stage['requestBody'])
        assert request['stream'] is True and request['enable_thinking'] is False
        text = ''.join(event['delta'] for event in client_events if event['type'] == 'text-delta' and event['id'] == stage['stage'])
        assert text == stage['answer']
        if stage['stage'] == 'summary' or index == 0:
            assert stage['finishReason'] == 'stop'
        else:
            assert stage['finishReason'] is None and stage['endedBy'] is None
            assert stage['error']['code'] == 'REQUEST_CANCELLED'
        stages.append({key: stage[key] for key in ['stage', 'responseModel', 'firstContentMs', 'streamEndMs', 'endedBy', 'finishReason', 'usage', 'answer']})
    if index == 0:
        assert len(server['stages'][1]['answer'].strip().splitlines()) == 3
    summaries.append({'attempt': index + 1, 'state': expected, 'uiEventCount': len(client_events), 'progress': progress, 'keyEvents': [item for item in attempt['events'] if item['event']['type'] != 'text-delta'], 'stages': stages})
report = {'verifiedCode': 'bc6325ef26487866203fe83543be416d4510c676', 'recordSha256': hashlib.sha256(raw.encode()).hexdigest(), 'assertions': '正常完成与实际停止均通过；双侧事件一致；历史快照不再变化；按文本段重建与模型返回一致', 'attempts': summaries}
(root / '实测核对.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
