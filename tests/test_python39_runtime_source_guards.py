import ast
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_MODULES = [
    REPO_ROOT / "backend",
    REPO_ROOT / "jira_server.py",
]


def iter_python_files(paths):
    for path in paths:
        if path.is_file():
            yield path
        else:
            yield from path.rglob("*.py")


def has_future_annotations(tree):
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(getattr(node, "value", None), ast.Constant):
            if isinstance(node.value.value, str):
                continue
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            if any(alias.name == "annotations" for alias in node.names):
                return True
            continue
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        break
    return False


def contains_none_union(node):
    if node is None:
        return False
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return contains_none_union(node.left) or contains_none_union(node.right)
    if isinstance(node, ast.Constant) and node.value is None:
        return True
    return any(contains_none_union(child) for child in ast.iter_child_nodes(node))


class NoneUnionAnnotationVisitor(ast.NodeVisitor):
    def __init__(self):
        self.found = False

    def visit_arg(self, node):
        if contains_none_union(node.annotation):
            self.found = True
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if contains_none_union(node.annotation):
            self.found = True
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        if contains_none_union(node.returns):
            self.found = True
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        if contains_none_union(node.returns):
            self.found = True
        self.generic_visit(node)


class Python39RuntimeSourceGuards(unittest.TestCase):
    def test_pep604_none_annotations_are_deferred_for_python39_runtime_imports(self):
        offenders = []
        for path in iter_python_files(RUNTIME_MODULES):
            source = path.read_text()
            tree = ast.parse(source, filename=str(path))
            visitor = NoneUnionAnnotationVisitor()
            visitor.visit(tree)
            if visitor.found and not has_future_annotations(tree):
                offenders.append(str(path.relative_to(REPO_ROOT)))

        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
