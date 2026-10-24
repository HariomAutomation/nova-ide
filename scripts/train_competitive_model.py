#!/usr/bin/env python3
"""
Competitive Titanic pipeline — with an HONEST cross-validation.

Why this file changed
---------------------
The previous version reported 85.19% from leave-one-out CV, while the real public
score was 0.79904. That 6-point gap was not the model being bad — it was the
*measurement* being wrong, and the reason is specific:

    The strong feature is "did the rest of my family/ticket group survive?", read
    off the training labels.

  - For a TRAIN passenger, their group-mates are mostly in train too, so the
    feature is usually available and computed from several people.
  - For a TEST passenger, their group-mates are often in test too, so the feature
    is frequently unavailable and the fallback rules take over.

Leave-one-out holds out one ROW, so the group-mates stay in training and the
feature stays available. It therefore measures a situation that is easier than
test. GroupKFold holds out a whole GROUP, which reproduces the test condition:
a validation passenger's group-mates are unseen, exactly as they will be.

Run
---
    python3 scripts/train_competitive_model.py                 # CV + submission
    python3 scripts/train_competitive_model.py --selftest      # prove no leakage
    python3 scripts/train_competitive_model.py --data data/titanic
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

FAMILY_LARGE = 5


# --------------------------------------------------------------------------- #
# features
# --------------------------------------------------------------------------- #

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """Title, surname, family size, and the group key used for CV and the signal."""
    df = df.copy()

    df["Title"] = df["Name"].str.extract(r" ([A-Za-z]+)\.", expand=False)
    df["Title"] = df["Title"].replace(["Mlle", "Ms"], "Miss")
    df["Title"] = df["Title"].replace(["Mme", "Countess", "Dona", "Lady"], "Mrs")
    df["Title"] = df["Title"].replace(
        ["Capt", "Col", "Major", "Sir", "Don", "Jonkheer", "Rev", "Dr"], "Officer"
    )

    df["Surname"] = df["Name"].apply(lambda x: str(x).split(",")[0].strip())
    df["FamilySize"] = df["SibSp"] + df["Parch"] + 1
    # "woman or boy" is the single strongest signal on this dataset
    df["IsWomanOrBoy"] = ((df["Sex"] == "female") | (df["Title"] == "Master")).astype(int)

    # Group key: a shared ticket is the tightest grouping; otherwise the surname
    # within a class. The point is that a whole group must land in one fold.
    ticket_counts = df["Ticket"].value_counts()
    shared_ticket = df["Ticket"].map(ticket_counts) > 1
    df["GroupKey"] = np.where(
        shared_ticket,
        "T:" + df["Ticket"].astype(str),
        "S:" + df["Surname"].astype(str) + "_" + df["Pclass"].astype(str),
    )
    return df


# --------------------------------------------------------------------------- #
# the rule set (unchanged in substance, so the CV change is isolated)
# --------------------------------------------------------------------------- #

def base_prediction(row) -> int:
    """The fallback when there is no group signal: woman or boy survives."""
    return 1 if row["IsWomanOrBoy"] == 1 else 0


def apply_rules(row) -> int:
    """The hand-derived steerage rules, applied before any group override."""
    if row["Pclass"] == 3 and row["Sex"] == "female" and row["FamilySize"] >= FAMILY_LARGE:
        return 0
    if row["Pclass"] == 3 and row["Title"] == "Master" and row["FamilySize"] >= FAMILY_LARGE:
        return 0
    return base_prediction(row)


def fit_group_survival(train_slice: pd.DataFrame) -> dict:
    """
    Mean survival per group, from the woman/boy members only.

    This MUST be called with a training slice and nothing else — feeding it the
    whole frame is exactly the leakage this file exists to remove.
    """
    wb = train_slice[train_slice["IsWomanOrBoy"] == 1]
    grouped = wb.groupby("GroupKey")["Survived"].mean()
    return {k: float(v) for k, v in grouped.items()}


def predict_one(row, lookup: dict) -> int:
    """Rules first, then the group signal when the group has a known outcome."""
    pred = apply_rules(row)
    if row["GroupKey"] in lookup:
        group_surv = lookup[row["GroupKey"]]
        if group_surv == 0.0:
            pred = 0
        elif group_surv == 1.0 and row["IsWomanOrBoy"] == 1:
            pred = 1
    return pred


# --------------------------------------------------------------------------- #
# the honest CV
# --------------------------------------------------------------------------- #

def group_cv(train: pd.DataFrame, n_splits: int = 5, return_folds: bool = False):
    """
    Out-of-fold accuracy with whole groups held out.

    The group signal for each fold is built ONLY from that fold's training slice,
    so a validation passenger's group-mates are unseen — the same situation the
    test set is in.
    """
    groups = train["GroupKey"].values
    gkf = GroupKFold(n_splits=n_splits)

    preds = np.zeros(len(train), dtype=int)
    folds = []

    for fold_i, (tr_idx, va_idx) in enumerate(gkf.split(train, groups=groups)):
        tr = train.iloc[tr_idx]
        va = train.iloc[va_idx]
        lookup = fit_group_survival(tr)  # <-- training slice only

        if return_folds:
            folds.append({"train": tr, "valid": va, "lookup": lookup})

        for i, (_, row) in zip(va_idx, va.iterrows()):
            preds[i] = predict_one(row, lookup)

    accuracy = float((preds == train["Survived"].values).mean())
    return (accuracy, preds, folds) if return_folds else (accuracy, preds)


def loo_accuracy(train: pd.DataFrame) -> float:
    """
    The old, optimistic number — kept only so the gap can be shown, not to be
    trusted. Holding out a row leaves the group-mates in, which is the bug.
    """
    preds = np.zeros(len(train), dtype=int)
    for i in range(len(train)):
        tr = train.drop(train.index[i])
        lookup = fit_group_survival(tr)
        preds[i] = predict_one(train.iloc[i], lookup)
    return float((preds == train["Survived"].values).mean())


# --------------------------------------------------------------------------- #
# self test — proves the leakage is actually gone
# --------------------------------------------------------------------------- #

def selftest() -> int:
    """
    Synthetic data where group membership fully determines survival, then assert:

      1. no validation row's group signal is built from a passenger in its own fold
      2. group CV scores BELOW the naive leave-one-out number

    (2) is the whole point: if the two agreed, the grouping would be doing nothing.
    """
    rng = np.random.default_rng(7)
    n_groups, per_group = 60, 4
    rows = []
    for g in range(n_groups):
        # every member of a group shares one outcome — so group survival is a
        # perfect predictor and leakage is maximally visible
        outcome = int(rng.integers(0, 2))
        for m in range(per_group):
            rows.append({
                "PassengerId": len(rows) + 1,
                "Survived": outcome,
                "Pclass": 3,
                "Sex": "female" if m % 2 == 0 else "male",
                "SibSp": 1,
                "Parch": 1,
                "Name": f"Member{g}, Mr. P{len(rows)}",
                "Ticket": f"T{g}",
            })
    train = add_features(pd.DataFrame(rows))

    # 1. no leakage: contributors to a fold's lookup must not be in that fold
    _, _, folds = group_cv(train, n_splits=5, return_folds=True)
    problems = []
    for f, fold in enumerate(folds):
        valid_groups = set(fold["valid"]["GroupKey"])
        contributor_groups = set(fold["train"]["GroupKey"])
        overlap = valid_groups & contributor_groups
        if overlap:
            problems.append(f"fold {f}: groups in both train and valid: {sorted(overlap)[:3]}")

    # 2. the gap: group CV must be lower than the naive number
    group_acc, _ = group_cv(train, n_splits=5)
    naive_acc = loo_accuracy(train)

    print(f"  synthetic groups: {train['GroupKey'].nunique()}")
    print(f"  naive leave-one-out : {naive_acc:.4f}   <- inflated, group-mates leak in")
    print(f"  GroupKFold (honest) : {group_acc:.4f}   <- groups held out whole")
    print(f"  gap                 : {naive_acc - group_acc:+.4f}")

    ok = True
    if problems:
        ok = False
        for p in problems:
            print(f"  LEAK: {p}")
    else:
        print("  no group appears in both a fold's train and its validation slice  OK")

    if not naive_acc > group_acc:
        ok = False
        print(f"  FAIL: the honest score ({group_acc:.4f}) should be below the naive one ({naive_acc:.4f})")
    else:
        print("  the honest score is below the naive one, as it must be  OK")

    print("SELFTEST", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/titanic")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--splits", type=int, default=5)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    train_path = os.path.join(args.data, "train.csv")
    test_path = os.path.join(args.data, "test.csv")
    if not os.path.exists(train_path):
        print(f"no train.csv at {train_path} — run kaggle_data first, or pass --data")
        return 1

    train = add_features(pd.read_csv(train_path))
    test = add_features(pd.read_csv(test_path))

    group_acc, _ = group_cv(train, n_splits=args.splits)
    naive_acc = loo_accuracy(train)

    print(f"train rows: {len(train)}  groups: {train['GroupKey'].nunique()}")
    print(f"naive leave-one-out : {naive_acc:.4f}   (optimistic — do not trust this)")
    print(f"GroupKFold ({args.splits})     : {group_acc:.4f}   (the number to trust)")

    # Final model uses the WHOLE training set for its lookup — that is correct for
    # inference; only the CV has to hold groups out.
    lookup = fit_group_survival(train)
    preds = [predict_one(row, lookup) for _, row in test.iterrows()]
    out = pd.DataFrame({"PassengerId": test["PassengerId"], "Survived": preds})

    out_path = args.out or os.path.join(args.data, "submission_competitive.csv")
    out.to_csv(out_path, index=False)
    print(f"wrote {out_path}  ({len(out)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
