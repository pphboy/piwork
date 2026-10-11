"""Exercise the actual page refresh function and framework-safe CSS boundaries."""
import ast
from pathlib import Path
import re
from types import SimpleNamespace


def test_business_classes_are_scoped_without_overriding_framework_layout():
    root = Path(__file__).parent
    tree = ast.parse((root / 'ui.py').read_text())
    classes = [node.args[0].value for node in ast.walk(tree)
               if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
               and node.func.attr == 'classes' and node.args
               and isinstance(node.args[0], ast.Constant)]
    app_root = next(name for name in classes if name.endswith('-root'))
    prefix = app_root[:-4]
    assert all(name.startswith(prefix) for name in classes)
    css = (root / 'style.css').read_text()
    for selector_group in re.findall(r'([^{}]+)\{', css):
        if selector_group.strip().startswith('@'):
            continue
        for selector in selector_group.split(','):
            selector = selector.strip()
            assert selector == 'body' or selector.startswith('.' + app_root), selector
    assert all('.' + name in css for name in classes)


class Content:
    def __init__(self):
        self.labels = ['last confirmed content']
        self.clears = 0

    def classes(self, _value):
        return self

    def clear(self):
        self.labels.clear()
        self.clears += 1

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_refresh_keeps_confirmed_content_on_failure_and_recovers_at_same_or_new_version():
    tree = ast.parse((Path(__file__).parent / 'ui.py').read_text())
    refresh = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == 'refresh')
    content, notice, seen = Content(), SimpleNamespace(text=''), ['1']
    state = {'failing': True, 'version': '1'}

    def query(_name, _input):
        if state['failing']:
            raise RuntimeError('private implementation details')
        return {'stateVersion': state['version'], 'value': [{'title': 'fresh Todo', 'completed': True}]}

    def label(text):
        content.labels.append(text)
        return SimpleNamespace(classes=lambda _value: None)

    scope = {'station': SimpleNamespace(query=query), 'sync_notice': notice, 'seen': seen,
             'content': content, 'path': '/', 'ui': SimpleNamespace(label=label, row=lambda: Content())}
    exec(compile(ast.Module(body=[refresh], type_ignores=[]), 'actual_ui_refresh', 'exec'), scope)
    scope['refresh']()
    assert 'outdated' in notice.text and 'private' not in notice.text
    assert content.labels == ['last confirmed content'] and seen == ['1']
    assert content.clears == 0
    state['failing'] = False
    scope['refresh']()
    assert notice.text == '' and content.clears == 0
    state['version'] = '2'
    scope['refresh']()
    assert notice.text == '' and seen == ['2'] and content.clears == 1
    assert 'fresh Todo' in content.labels and 'Completed' in content.labels
