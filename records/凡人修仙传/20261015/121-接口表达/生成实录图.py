import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
record = json.loads((ROOT / '复用实录核对.json').read_text(encoding='utf-8'))
envelope = json.loads((ROOT / '14-context-start.json').read_text(encoding='utf-8'))
run = json.loads(envelope['body'])['run']
original = json.loads(run['tools'][0]['result'])['text']
age = next(line.strip() for line in original.splitlines() if '今年刚十岁' in line)
W, H = 2560, 1530
image = Image.new('RGB', (W, H), '#f7f8fa')
draw = ImageDraw.Draw(image)
font_path = 'C:/Windows/Fonts/msyh.ttc'
def font(size): return ImageFont.truetype(font_path, size)
def wrapped(text, x, y, width, size=38, color='#173e63', gap=16):
    line = ''
    for char in text:
        if char == '\n' or draw.textlength(line + char, font=font(size)) > width:
            draw.text((x, y), line, font=font(size), fill=color)
            y += size + gap
            line = '' if char == '\n' else char
        else: line += char
    if line:
        draw.text((x, y), line, font=font(size), fill=color)
        y += size + gap
    return y

draw.text((96, 62), '正文为空，查询仍在继续', font=font(64), fill='#173e63')
draw.text((96, 155), '2026-10-14 既有凡人实录 · Chat Completions · 本次复用没有新调用', font=font(34), fill='#647f9d')
cards = [(250, 530), (570, 980), (1020, 1325)]
for top, bottom in cards:
    draw.rounded_rectangle((96, top, W-96, bottom), radius=18, fill='white', outline='#c6d6e5', width=2)
draw.text((132, 280), '1  首轮返回：无正文，有工具调用', font=font(44), fill='#315f91')
wrapped('content: ""    finish_reason: tool_calls', 132, 350, 2260, 38)
wrapped('get_novel_excerpt({"source_id":"C01"})', 132, 409, 2260, 38)
wrapped('调用编号：' + record['first']['callId'], 132, 466, 2260, 30)
draw.text((132, 599), '2  应用读取 C01 完整原文，再回传到同一调用', font=font(44), fill='#315f91')
wrapped('本图仅节选能支持年龄的完整原句；JSON 原件保留完整工具返回。', 132, 669, 2260, 32, '#647f9d')
wrapped(age, 132, 734, 2260, 40, gap=20)
wrapped('tool_call_id：' + record['second']['toolCallId'], 132, 913, 2260, 30)
draw.text((132, 1050), '3  第二次请求带回工具结果，模型回答“十岁”', font=font(44), fill='#315f91')
wrapped('完整结束标记：' + record['second']['finishReason'] + '；本链共 ' + str(record['requestCount']) + ' 次真实模型请求。', 132, 1126, 2260, 38)
wrapped('只读取 content，会漏掉第一轮等待应用处理的查询。', 132, 1202, 2260, 40)
wrapped('首请求指定工具与 C01；这里核调用关联，不评价自主选工具。', 96, 1376, 2360, 32, '#647f9d')
wrapped('真实记录整理图 · 2560像素原图 · 直接读取既有JSON，不是浏览器截图。', 96, 1440, 2360, 30, '#647f9d')
image.save(ROOT / '空正文与真实查询链.png')
(ROOT / '图片生成方式.json').write_text(json.dumps({
    'kind': '真实记录整理图，不是浏览器截图', 'originalRecordDate': '2026-10-14',
    'source': '14-context-start.json', 'script': '生成实录图.py',
    'width': W, 'height': H, 'generatedFrom': ['实际content/finishReason/tool_call编号', '工具原文中的完整年龄段', '第二次请求与实际回答'],
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'image': str(ROOT / '空正文与真实查询链.png'), 'width': W, 'height': H}, ensure_ascii=False))
