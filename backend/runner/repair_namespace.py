# Vendored copy of ppt-master/skills/ppt-master/scripts/svg_finalize/repair_namespace.py
# Kept in sync manually. The original lives in the ppt-master submodule; the
# backend imports this vendored copy so it doesn't have to put the submodule
# scripts dir on sys.path. Bug fixes should be applied to the original first
# and then re-vendored.
"""SVG namespace repairer — the safety net for malformed root SVGs.

Why this exists
---------------
The Executor is an LLM. LLMs occasionally emit SVG with a wrong namespace,
typically the lxml-style ``ns0:`` prefix bound to a non-SVG URI (the most
common hallucination is ``http://www.w3.org/1990/svg`` instead of
``http://www.w3.org/2000/svg``). The browser refuses to render any element
in a non-SVG namespace, so the page comes back blank in the preview.

The post-processing pipeline in ``finalize_svg`` only rewrites a page when
one of its other steps (``embed_icons`` / ``align_images`` / ``flatten_tspan``
/ ``rect_to_path``) has actual work to do. A page whose only defect is a
malformed namespace gets none of those steps to touch it — so the bad file
copies straight from ``svg_output/`` into ``svg_final/`` and stays broken
indefinitely, even after the Executor regenerates a clean copy.

This module is the unconditional last step: it walks every page in
``svg_final/``, reparses it, and if the root is not a clean
``{http://www.w3.org/2000/svg}svg`` element, it re-tags the document and
re-serialises with the SVG namespace registered as the default prefix.
Pages that are already valid are returned unchanged so the file mtime does
not move for no reason.

It runs on lxml, not xml.etree, because lxml preserves namespaces
faithfully across re-serialisation and gives us real local-name access
to detect the broken prefix.
"""

from __future__ import annotations

import re
from pathlib import Path

from lxml import etree


SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"


# Substrings that, if they appear in the document's bound namespace URI,
# are evidence the root is not actually SVG. We only act on namespaces that
# are bound (i.e. they appear as a xmlns:nsX="…") and whose URI is close to
# the canonical SVG URI but wrong.
_SVG_NS_PREFIXES_TO_FIX = re.compile(r"^https?://www\.w3\.org/\d{4}/svg$")


def _looks_like_broken_svg_uri(uri: str) -> bool:
    """A URI that *looks* like the SVG namespace but is not it.

    Catches the common LLM hallucination ``http://www.w3.org/1990/svg``
    (year 1990 instead of 2000). We accept any year that doesn't match
    2000 so future hallucinations like 2001/svg or 1900/svg are also fixed.
    """
    if not uri:
        return False
    return bool(_SVG_NS_PREFIXES_TO_FIX.match(uri)) and uri != SVG_NS


def repair_svg_file(svg_path: Path, verbose: bool = False) -> bool:
    """Repair the namespace of a single SVG file in place.

    Returns ``True`` if the file was modified. A file whose root is already
    a clean ``{http://www.w3.org/2000/svg}svg`` is left untouched (no
    rewrite, mtime preserved).
    """
    try:
        tree = etree.parse(str(svg_path))
    except etree.XMLSyntaxError as e:
        if verbose:
            print(f"  [WARN] {svg_path.name}: cannot parse ({e})")
        return False

    root = tree.getroot()
    root_qname = etree.QName(root.tag)
    root_local = root_qname.localname
    root_ns = root_qname.namespace

    # Happy path: root is svg in the SVG namespace with no prefix on
    # children. We still need to check that no element anywhere in the
    # tree is bound to a broken SVG-ish URI.
    broken = root_ns != SVG_NS and _looks_like_broken_svg_uri(root_ns)
    if not broken:
        # Even with a clean root, an Executor might have nested a child
        # element in a wrong namespace. Walk the tree (skipping comments
        # and processing instructions, which aren't elements).
        for el in root.iter():
            if not isinstance(el.tag, str):
                continue
            ns = etree.QName(el.tag).namespace
            if _looks_like_broken_svg_uri(ns):
                broken = True
                break

    if not broken and root_local == "svg" and root_ns == SVG_NS:
        # Double-check: do any descendant tags carry the ns0: prefix?
        # A clean root with a polluted child is still a renderer hazard.
        for el in root.iter():
            if not isinstance(el.tag, str):
                continue
            qn = etree.QName(el.tag)
            if qn.namespace and qn.namespace != SVG_NS and not qn.namespace.startswith(XLINK_NS):
                # any other non-xlink namespace pollution
                if _looks_like_broken_svg_uri(qn.namespace) or qn.namespace.startswith(
                    "http://www.w3.org/1990"
                ):
                    broken = True
                    break
        if not broken:
            return False

    # ---- Repair pass ---------------------------------------------------
    # Strategy: re-tag every element whose namespace URI is a wrong
    # SVG-year URI by moving it into the canonical SVG namespace, then
    # rebuild the tree under a fresh root with the SVG namespace bound to
    # the default (empty) prefix. That guarantees a clean output with
    # ``<svg xmlns="…">`` and unprefixed child tags.
    retag_count = 0
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        qn = etree.QName(el.tag)
        if _looks_like_broken_svg_uri(qn.namespace):
            el.tag = f"{{{SVG_NS}}}{qn.localname}"
            retag_count += 1
        elif qn.namespace is None and root_local == "svg" and root_ns != SVG_NS:
            pass

    # Build a fresh tree with the SVG namespace as the default prefix.
    # Preserves xlink on the root (some SVGs reference href="…#id" with
    # xlink:href — keep the binding so we don't break those refs).
    nsmap = {None: SVG_NS, "xlink": XLINK_NS}
    if root_local != "svg":
        # The root was some other element with no local "svg" — extremely
        # unlikely, but if it happens we still want a renderable doc.
        new_root = etree.Element(root.tag, nsmap=nsmap)
    else:
        new_root = etree.Element(f"{{{SVG_NS}}}svg", nsmap=nsmap)
    for k, v in root.attrib.items():
        # Don't copy the broken namespace declaration over.
        if k.startswith("xmlns"):
            continue
        new_root.set(k, v)
    for child in list(root):
        new_root.append(child)
    new_root.text = root.text
    tree = etree.ElementTree(new_root)
    root = new_root
    retag_count += 1

    # Re-serialise. With nsmap[None] = SVG_NS lxml emits <svg> (no prefix)
    # and unprefixed children, which is what browsers and svg_to_pptx both
    # expect.
    final_bytes = etree.tostring(
        tree,
        xml_declaration=False,
        encoding="utf-8",
        pretty_print=False,
    )

    # Last-mile cleanup: even with lxml's nsmap, residual ns0: prefixes
    # can survive on children whose URI is the canonical SVG_NS but were
    # not rewritten (defensive). The text-level rewrite below handles
    # anything lxml still emitted with a prefix.
    text = final_bytes.decode("utf-8")
    # Replace any lingering xmlns:nsX="…svg" with xmlns="…svg" + drop the
    # matching nsX: prefixes on tags. We do this conservatively: only the
    # *known-bad* URI pattern, never the correct 2000/svg.
    pattern = re.compile(
        r'<ns(\d+):([A-Za-z][\w:-]*)(\s[^>]*)?>', re.DOTALL
    )
    matches = list(pattern.finditer(text))
    if matches:
        # Rewrite all nsX: prefixed opening tags to unprefixed.
        text = pattern.sub(lambda m: f"<{m.group(2)}{m.group(3) or ''}>", text)
        text = re.sub(r'</ns\d+:', '</', text)
        # Drop the xmlns:nsX="…" declarations.
        text = re.sub(
            r'\s+xmlns:ns\d+="http://www\.w3\.org/\d{4}/svg"',
            '',
            text,
        )
        final_bytes = text.encode("utf-8")

    # Make sure the root declares the canonical SVG namespace.
    if b'xmlns="http://www.w3.org/2000/svg"' not in final_bytes:
        final_bytes = final_bytes.replace(
            b'<svg ',
            b'<svg xmlns="http://www.w3.org/2000/svg" ',
            1,
        )

    svg_path.write_bytes(final_bytes)
    if verbose:
        print(
            f"  [REPAIR] {svg_path.name}: retagged {retag_count} element(s)"
        )
    return True


def repair_directory(svg_dir: Path, verbose: bool = False) -> int:
    """Repair every ``*.svg`` file in ``svg_dir`` in place. Returns count."""
    if not svg_dir.is_dir():
        return 0
    repaired = 0
    for svg_path in sorted(svg_dir.glob("*.svg")):
        if repair_svg_file(svg_path, verbose=verbose):
            repaired += 1
    return repaired


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Repair malformed SVG namespaces in a directory of SVGs."
    )
    parser.add_argument(
        "svg_dir",
        type=Path,
        help="Directory containing *.svg files (e.g. svg_final/)",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    n = repair_directory(args.svg_dir, verbose=args.verbose)
    print(f"Repaired {n} file(s) in {args.svg_dir}")
    sys.exit(0)
