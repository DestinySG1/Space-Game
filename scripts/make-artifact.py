"""Turn dist/index.html into a body-only page for publishing as a claude.ai artifact.

The artifact host adds its own <!doctype>/<html>/<head>/<body> skeleton, so this keeps the
title, styles, inline script and body content and drops the outer document tags.
Usage: python3 scripts/make-artifact.py dist/index.html <out.html>
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf-8').read()

head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
title = re.search(r'<title>.*?</title>', head, re.S).group(0)
styles = ''.join(re.findall(r'<style[^>]*>.*?</style>', head, re.S))
scripts = ''.join(re.findall(r'<script[^>]*>.*?</script>', head + body, re.S))
body = re.sub(r'<script[^>]*>.*?</script>', '', body, flags=re.S)

page = (
    f'{title}\n<meta name="claude:viewport-fit-sides" content="cover">\n'
    f'{styles}\n{body.strip()}\n{scripts}\n'
)
open(out, 'w', encoding='utf-8').write(page)
print(f'{out}: {len(page)} bytes')
