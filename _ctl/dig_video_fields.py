"""Dig request-builder field names for the video endpoints out of the bundle.

The bundle is obfuscated, but string literals survive, so video request field names
can be recovered by scanning the literals the bundle still carries.
"""
import glob
import re

PATHS = [
    "batchAsyncGenerateVideoText",
    "batchAsyncGenerateVideoStartImage",
    "batchAsyncGenerateVideoStartAndEndImage",
    "batchAsyncGenerateVideoReferenceImages",
    "batchAsyncGenerateVideoExtendVideo",
    "batchAsyncGenerateVideoEditVideo",
    "batchAsyncGenerateVideoUpsampleVideo",
]

CANDIDATES = [
    "textInput", "imageInput", "startImage", "endImage", "referenceImages",
    "videoInput", "inputVideo", "mediaInput", "imageInputs", "referenceImageInputs",
    "structuredPrompt", "videoModelKey", "aspectRatio", "seed", "metadata",
    "mediaGenerationContext", "clientContext", "useV2ModelConfig",
    "audioFailurePreference", "batchId", "requests",
    "videoGenerationMode", "videoResolution", "characters", "audioReference",
    "extensionInput", "upsampleInput", "editInput", "interpolationInput",
    "sourceMediaId", "baseImageMediaGenerationId", "mediaId", "videoModelName",
]


def main():
    text = ""
    for f in glob.glob("_ctl/js/*.js"):
        text += open(f, encoding="utf-8", errors="ignore").read()

    print("== endpoint path literals ==")
    for p in PATHS:
        print(f"  {p}: {len(re.findall(re.escape(p), text))} lan")

    print()
    print("== field-name literals co trong bundle ==")
    for c in CANDIDATES:
        n = len(re.findall(r"['\"]" + re.escape(c) + r"['\"]", text))
        print(f"  {c}: {'co' if n else 'KHONG'} ({n})")

    print()
    print("== literal ket thuc bang Input / Inputs ==")
    for x in sorted(set(re.findall(r"['\"]([a-z][A-Za-z]{2,30}Inputs?)['\"]", text))):
        print("  ", x)

    print()
    print("== ngu canh quanh cac field input cua video ==")
    for name in ("textInput", "imageInput", "startImage", "endImage",
                 "referenceImages", "videoInput", "editInput",
                 "videoGenerationVideoInputs", "videoGenerationImageInputs",
                 "videoGenerationLikenessInputs", "videoGenerationAudioInputs",
                 "videoGenerationEntityInputs"):
        for m in re.finditer(r"['\"]" + re.escape(name) + r"['\"]", text):
            seg = text[max(0, m.start() - 220):m.end() + 220]
            seg = re.sub(r"\s+", " ", seg)
            print(f"-- {name}: {seg}")
            break

    print()
    print("== khoi validator quanh videoGenerationVideoInputs ==")
    m = re.search(r"['\"]videoGenerationVideoInputs['\"]", text)
    if m:
        seg = text[max(0, m.start() - 4000):m.end() + 1500]
        # Keep only the quoted field names, in order: that is the request schema.
        names = re.findall(r"['\"]([a-zA-Z][a-zA-Z0-9_]{2,40})['\"]\s*:", seg)
        seen = []
        for n in names:
            if n not in seen:
                seen.append(n)
        print("   field theo thu tu xuat hien:")
        for n in seen:
            print("     ", n)

    print()
    print("== enum videoGenerationOrigin va reshootMotionType ==")
    for pat in (r"VIDEO_GENERATION_ORIGIN_[A-Z0-9_]+", r"RESHOOT_MOTION_TYPE_[A-Z0-9_]+"):
        vals = sorted(set(re.findall(pat, text)))
        print(f"  {pat}: {len(vals)}")
        for v in vals:
            print("     ", v)

    print()
    print("== field cua videoModelControlInput / cac *Inputs ==")
    for anchor in ("videoModelControlInput", "videoGenerationImageInputs",
                   "videoGenerationVideoInputs", "videoGenerationAudioInputs",
                   "videoGenerationEntityInputs", "videoGenerationLikenessInputs"):
        m = re.search(r"['\"]" + anchor + r"['\"]\s*:\s*_0x[0-9a-f]+", text)
        print(f"  {anchor}: {'tim thay khai bao' if m else 'khong ro'}")


if __name__ == "__main__":
    main()
