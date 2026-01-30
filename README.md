# pipelinetheatre

Pipeline d’ingestion pour « Au théâtre ce soir » (Bruxelles).

## Objectif
Unifier la collecte → normalisation → déduplication → publication (Supabase).

## Principes
- Les connecteurs (sources) vivent dans `src/connectors/`.
- Le pipeline produit des événements normalisés (type unique).
- Déduplication via `fingerprint`.
- Import CSV manuel reste possible côté app (plan B).

## Usage
À venir.
