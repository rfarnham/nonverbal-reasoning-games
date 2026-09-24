#!/usr/bin/env python3
"""Expand the approved bank into two passes through sixteen reviewed concepts.

New question selections remain under ignored work/ until separately approved.
Published builds use the committed approved runtime. This authoring plan contains references,
not source text, answers, images, private paths, or reviewer solution notes.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'work/math-world-curriculum-32'
RUN_ID = 'catalogue-8b9cfc0f0f01b9ef7138902e'
STRANDS = [
    ('counting', 'Counting', 'Counting Coast', 'Count carefully and organize what you see.', 'number_arithmetic'),
    ('symmetry', 'Symmetry & Turns', 'Mirror Meadow', 'Follow reflections, turns, and folds.', 'geometry_spatial'),
    ('arithmetic', 'Arithmetic', 'Number Orchard', 'Join, separate, and work with equal groups.', 'number_arithmetic'),
    ('patterns', 'Patterns & Cycles', 'Pattern Grove', 'Find repeating units, growing rules, and recurring steps.', 'number_arithmetic'),
    ('shapes', 'Shape Building', 'Shape Shoals', 'Match, compose, and rebuild flat shapes.', 'geometry_spatial'),
    ('logic', 'Logic', 'Logic Lagoon', 'Use every clue to rule out what cannot work.', 'logic_constraints'),
    ('groups-sharing', 'Groups & Sharing', 'Sharing Gardens', 'Build equal groups and share fairly.', 'number_arithmetic'),
    ('digits', 'Digits & Codes', 'Digit Dunes', 'Explore place value and number properties.', 'number_arithmetic'),
    ('routes', 'Routes & Grids', 'Trail Treetops', 'Trace paths, follow directions, and organize routes.', 'geometry_spatial'),
    ('fractions', 'Fractions', 'Fraction Falls', 'Connect equal parts with the whole.', 'number_arithmetic'),
    ('solids', 'Solids & Views', 'Cube Cliffs', 'Connect flat views, hidden cubes, and solid shapes.', 'geometry_spatial'),
    ('measurement', 'Length & Measure', 'Measuring Mills', 'Compare quantities and reason with measured units.', 'measurement_time'),
    ('money', 'Money & Value', 'Market Harbor', 'Combine prices, make change, and compare value.', 'measurement_time'),
    ('time', 'Time', 'Clockwork Gardens', 'Read clocks, follow calendars, and connect intervals.', 'measurement_time'),
    ('area', 'Area & Boundary', 'Patchwork Terraces', 'Compare covered space and trace the boundary.', 'geometry_spatial'),
    ('missing-values', 'Missing Values', 'Balance Bay', 'Find unknown quantities while keeping relationships true.', 'number_arithmetic'),
]
ANCHORS = [(10,73,27,89),(23,56,70,80),(35,76,29,70),(45,51,68,60),(59,65,27,50),(68,44,69,40),(80,54,28,30),(78,24,68,20),(90,21,44,10)]
STAGES = [('Discover', 'Notice the central idea.'), ('Explore', 'Try the idea in another setting.'), ('Connect', 'Combine the clues and choose a useful method.'), ('Summit', 'Use what you learned more independently.')]
BOSS_HOLDOUTS = json.loads((ROOT/'content/math-world/boss-holdouts.json').read_text())

def assert_not_boss_holdout(item_id: str, source: dict) -> None:
    """Reject annual challenge exposure, including documented alternate source IDs."""
    identities = {item_id, *(source.get(key) for key in ('id', 'itemId', 'item_id', 'sourceId', 'canonicalId', 'occurrenceId'))}
    rule = BOSS_HOLDOUTS['matchingPolicy']['metadataFallback']
    family = str(source.get('sourceFamily', source.get('source_family', '')))
    kind = source.get('sourceKind', source.get('source_kind', 'contest'))
    part = source.get('paperPart', source.get('paper_part', ''))
    markers = set(re.split(r'[^a-z]+', f'{family} {part}'.lower()))
    usa_contest = (family.lower().startswith(rule['sourceFamilyPrefix'].lower())
                   and kind not in rule['excludedSourceKinds']
                   and not markers.intersection(rule['excludedSourceMarkers']))
    for challenge in BOSS_HOLDOUTS['challenges']:
        exact = any(reference['sourceId'] in identities
                    or any(alias['id'] in identities for alias in reference['reservedReferences'])
                    for reference in challenge['questions'])
        annual_source = (usa_contest and str(source.get('year')) == str(challenge['year'])
                         and source.get('gradeBand', source.get('grade_band')) == challenge['gradeBand'])
        if exact or annual_source:
            raise ValueError(f"Math Worlds boss holdout: {item_id} is reserved for the {challenge['year']} Grades {challenge['gradeBand']} challenge after world {challenge['afterWorldNumber']}. Remove it from the teaching worlds; keep the complete test separate (content/math-world/boss-holdouts.json).")

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def normalize(value: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', value.lower())

def build(catalogue: Path, reviews: list[Path], output: Path, plan: Path) -> dict:
    taxonomy = json.loads((ROOT/'content/math-world/competition-math-taxonomy.v1.0.0.proposed.json').read_text())
    topics = {topic['id'] for family in taxonomy['domains'] for topic in family['topics']}
    strategies = set(taxonomy['tag_vocabularies']['strategies'])
    concepts = {row[0] for row in STRANDS}
    connection = sqlite3.connect(f'file:{catalogue}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    rows = {row['item_id']: dict(row) for row in connection.execute('SELECT * FROM catalogue_items WHERE run_id=?', (RUN_ID,))}
    connection.close()
    groups = defaultdict(list)
    preserved = json.loads((ROOT/'content/math-world/spiral-20.runtime.json').read_text())
    preserved_plan = json.loads((ROOT/'content/math-world/spiral-20.plan.json').read_text())
    existing_worlds = {world['id']: world for world in preserved['worlds']}
    existing_plans = {world['id']: world for world in preserved_plan['worlds']}
    seen_ids = {question['id'] for question in preserved['questions']}
    seen_assets = {question['asset']['sha256']: question['id'] for question in preserved['questions']}
    warnings = []
    asset_copies = {Path(question['asset']['src']).name: ROOT/'public'/question['asset']['src'].lstrip('/') for question in preserved['questions']}
    textual_signatures = {normalize(question['prompt']): question['id'] for question in preserved['questions']
                          if len(normalize(question['prompt'])) > 100}
    for review_file in reviews:
        envelope = json.loads(review_file.read_text())
        if envelope['catalogueRunId'] != RUN_ID:
            raise ValueError(f'Unpinned catalogue: {review_file.name}')
        for record in envelope['records']:
            if record.get('excludeReason'):
                continue
            item_id = record['itemId']
            if item_id in seen_ids:
                raise ValueError(f'Duplicate question selection: {item_id}')
            seen_ids.add(item_id)
            row = rows[item_id]
            assert_not_boss_holdout(item_id, {**row, 'sourceKind': record.get('sourceKind', 'contest')})
            if record['contentVersion'] != row['content_version']:
                raise ValueError(f'Stale content review: {item_id}')
            concept, spiral = record['conceptId'], record['pass']
            if concept not in concepts or spiral not in (1,2):
                raise ValueError(f'Unknown curriculum home: {item_id}')
            topic = record['primaryTopic']
            secondary = record.get('secondaryTopics', [])
            methods = record.get('strategies', [])
            if topic not in topics or len(secondary)>3 or len(methods)>3 or any(t not in topics for t in secondary) or any(s not in strategies for s in methods) or topic in secondary or len(set(secondary)) != len(secondary):
                raise ValueError(f'Invalid taxonomy annotation: {item_id}')
            review = record['review']
            if not review.get('diagramInspected') or not review.get('answerVerified') or not review.get('basis', '').strip():
                raise ValueError(f'Incomplete source review: {item_id}')
            point = record['pointTier']
            band = row['grade_band']
            if not ((band=='1-2' and point in (3,4,5)) or (band=='3-4' and point in (3,4))):
                raise ValueError(f'Outside requested grade/point scope: {item_id}')
            stored_tier = row['published_point_tier']
            if stored_tier is not None and int(stored_tier) != point:
                raise ValueError(f'Tier changed from its source: {item_id}')
            if not record.get('tierBasis') or (stored_tier is None and record['tierBasis']=='catalogue-metadata'):
                raise ValueError(f'Point tier needs source evidence: {item_id}')
            if row['answer_status'] not in ('official-verified', 'provider-answer-page-verified', 'provider-answer-edition-verified'):
                raise ValueError(f'Unverified source answer: {item_id}')
            if row['answer_status'].startswith('provider-') and record.get('sourceKind') not in ('practice', 'mock'):
                raise ValueError(f'Provider answer needs explicit practice attribution and review: {item_id}')
            if record['reasoningDemand'] not in (1,2,3,4,5):
                raise ValueError(f'Invalid reviewed reasoning demand: {item_id}')
            source = json.loads(row['source_payload_json'])
            learner = json.loads(row['learner_payload_json'])
            assets = json.loads(row['asset_refs_json'])
            asset = next((asset for asset in assets if asset.get('status')=='available' and Path(asset.get('local_ref', '')).is_file()), None)
            if not asset:
                raise ValueError(f'Missing source card: {item_id}')
            source_path = Path(asset['local_ref'])
            asset_hash = digest(source_path)
            reviewed_hash = review.get('assetSha256') or review.get('sourceCardSha256')
            if reviewed_hash and reviewed_hash != asset_hash:
                raise ValueError(f'Image changed since review: {item_id}')
            if override := record.get('assetOverride'):
                override_path = (WORK / override['relativePath']).resolve()
                if not override_path.is_relative_to(WORK.resolve()) or not override_path.is_file() or digest(override_path) != override['sha256'] or not review.get('assetOverrideInspected'):
                    raise ValueError(f'Unreviewed derived source card: {item_id}')
                source_path = override_path
                asset_hash = override['sha256']
                asset = {**asset, 'width': override['width'], 'height': override['height']}
            if asset_hash in seen_assets:
                raise ValueError(f'Duplicate source card: {item_id} / {seen_assets[asset_hash]}')
            seen_assets[asset_hash] = item_id
            correct = source.get('official_answer')
            if correct not in list('ABCDE'):
                raise ValueError(f'No canonical single answer: {item_id}')
            if review.get('computedAnswer') != correct or review.get('officialAnswer') != correct:
                raise ValueError(f'Reviewed solution and official key must agree: {item_id}')
            raw_choices = record.get('choicesOverride') or learner.get('choices') or source.get('choices')
            if not isinstance(raw_choices,list) or len(raw_choices) not in (2,3,4,5):
                raise ValueError(f'Expected two to five complete original source choices: {item_id}')
            choices=[]
            for index, choice in enumerate(raw_choices):
                text=str(choice).strip(); letter='ABCDE'[index]
                visual = not text or bool(re.search(r'visual option|answer image|image option', text, re.I))
                choices.append({'label': letter if visual else text, 'accessibleLabel':f'Choice {letter}. Refer to the original question card.' if visual else f'Choice {letter}: {text}', 'visualOnly':visual})
            if 'ABCDE'.index(correct) >= len(choices):
                raise ValueError(f'Answer outside source choices: {item_id}')
            textual=[re.sub(r'\s+', '', choice['label'].casefold()) for choice in choices if not choice['visualOnly']]
            if len(textual)!=len(set(textual)):
                raise ValueError(f'Duplicate semantic choices need review: {item_id}')
            prompt = str(record.get('promptOverride') or learner.get('stem_markdown') or source.get('stem_markdown') or '').strip()
            if not prompt:
                raise ValueError(f'Missing question prompt: {item_id}')
            # Flag shared long statements for visual cross-edition review, never
            # deduplicate short generic prompts whose diagrams are the problem.
            signature=normalize(prompt)
            if len(signature)>100 and signature in textual_signatures:
                other=textual_signatures[signature]
                if not review.get('statementVariantBasis', '').strip():
                    raise ValueError(f'Possible repeated statement needs adjudication: {item_id} / {other}')
                warnings.append({'itemId': item_id, 'sameStatementAs': other, 'resolution': 'Distinct diagram/value variant explicitly reviewed.'})
            if len(signature)>100:
                textual_signatures[signature]=item_id
            filename=f'{item_id}{source_path.suffix.lower()}'
            asset_copies[filename]=source_path
            realm = next(strand[4] for strand in STRANDS if strand[0]==concept)
            source_kind=record.get('sourceKind','contest')
            if source_kind not in ('contest','practice','mock'):
                raise ValueError(f'Unknown source kind: {item_id}')
            source_label=f"{row['source_family']} {row['year']} · Grades {band.replace('-', '–')} · {point} points"
            if source_kind != 'contest': source_label+=f' · {source_kind}'
            question={
                'id':item_id, 'worldId':f'{concept}-{spiral}', 'stopId':'', 'prompt':prompt, 'choices':choices,
                'correctIndex':'ABCDE'.index(correct),
                # A wording repair does not remove the source's visual dependency.
                'presentation':'semantic' if row['modality']=='text_extractable' and not any(choice['visualOnly'] for choice in choices) else 'source-card',
                'showPrompt':bool(record.get('promptOverride')),
                'asset':{'src':f'/math-world/spiral-questions/{filename}','width':int(asset['width']),'height':int(asset['height']),'sha256':asset_hash,'alt':'Original competition question card. Use the answer choices below.'},
                'source':{'contentVersion':row['content_version'],'year':int(row['year']),'gradeBand':band,'questionNumber':int(row['question_number']),'sourceLabel':source_label,'sourceFamily':row['source_family'],'sourceKind':source_kind,'answerStatus':row['answer_status'],'pointTier':point,'tierBasis':record['tierBasis']},
                'curriculum':{'realmId':realm,'districtId':concept,'skillIds':[topic], 'primaryTopic':topic,'secondaryTopics':secondary,'strategies':methods,'reasoningDemand':record['reasoningDemand'],'placementVersion':'elementary_competition_math.1.0.0','placementStatus':'agent-reviewed','proposalConfidence':None},
            }
            reference={'itemId':item_id,'contentVersion':row['content_version'],'primaryTopic':topic,'secondaryTopics':secondary,'strategies':methods,'reasoningDemand':record['reasoningDemand'],'gradeBand':band,'pointTier':point,'year':int(row['year']),'sourceKind':source_kind,'assetSha256':asset_hash}
            groups[(concept,spiral)].append((record,question,reference))
    worlds,stops,breaks,questions,world_plans=[],[],[],[],[]
    for spiral in (1,2):
        for concept,label,title,description,realm in STRANDS:
            number=len(worlds)+1; world_id=f'{concept}-{spiral}'
            if world_id in existing_worlds:
                if groups[(concept,spiral)]:
                    raise ValueError(f'Existing question order must remain unchanged: {world_id}')
                worlds.append({**existing_worlds[world_id], 'number':number, 'theme':number-1, 'questionCount':existing_plans[world_id]['questionCount']})
                stops.extend(stop for stop in preserved['stops'] if stop['worldId']==world_id)
                questions.extend(question for question in preserved['questions'] if question['worldId']==world_id)
                world_plans.append({**existing_plans[world_id], 'number':number, 'theme':number-1})
                continue
            entries=groups[(concept,spiral)]
            configurations={10:(2,5),12:(2,6),15:(3,5),18:(3,6),20:(4,5),24:(4,6)}
            if len(entries) not in configurations:
                raise ValueError(f'{world_id} needs two to four complete stops of five or six questions, found {len(entries)}')
            # Human-reviewed reasoning demand governs order; grade and points are
            # source metadata, useful only as secondary scaffolding signals.
            entries.sort(key=lambda item:(item[0]['reasoningDemand'],item[1]['source']['gradeBand']=='3-4',item[0]['pointTier'],-item[1]['source']['year'],item[0].get('orderHint',0),item[0]['itemId']))
            stop_count,_=configurations[len(entries)]; stop_ids=[]
            for index in range(stop_count):
                slot=round(index*8/(stop_count-1)) if stop_count>1 else 8
                x,y,mx,my=ANCHORS[slot]
                stage,stage_description=STAGES[index if stop_count==4 else (3 if index==stop_count-1 else index)]
                stop_id=f'{world_id}-stop-{index+1}';stop_ids.append(stop_id)
                stops.append({'id':stop_id,'worldId':world_id,'mapSlot':slot,'kind':'culmination' if index==stop_count-1 else 'math-kangaroo','label':f'{label} {spiral} · {stage}','shortLabel':stage,'description':stage_description,'realmId':realm,'districtLabel':f'{label} {spiral}','x':x,'y':y,'mobileX':mx,'mobileY':my})
                for _,question,_ in entries[index*len(entries)//stop_count:(index+1)*len(entries)//stop_count]:
                    question['stopId']=stop_id
            worlds.append({'id':world_id,'number':number,'title':title if spiral==1 else f'{title} II','concept':label,'conceptId':concept,'spiral':spiral,'theme':number-1,'description':description,'stopIds':stop_ids,'questionCount':len(entries)})
            questions.extend(question for _,question,_ in entries)
            world_plans.append({**worlds[-1],'questionCount':len(entries),'questions':[reference for _,_,reference in entries]})
    content_hash=hashlib.sha256(json.dumps({'worlds':worlds,'questions':questions},sort_keys=True).encode()).hexdigest()[:16]
    version=f'spiral-32.v1.{content_hash}'
    runtime={'schemaVersion':2,'mode':'spiral-preview','contentVersion':version,'compatibleProgressVersions':[preserved['contentVersion']],'ontologyVersion':'elementary_competition_math.1.0.0','worlds':worlds,'stops':stops,'breaks':breaks,'questions':questions}
    plan_data={'schemaVersion':1,'contentVersion':version,'status':'agent-reviewed-public-playtest','catalogueRunId':RUN_ID,'taxonomyVersion':'elementary_competition_math.1.0.0','selectionPolicy':{'maximumWorldQuestions':24,'stopsPerWorld':[2,3,4],'questionsPerStop':[5,6],'recentTestsPreferred':True,'gradePointTiers':{'1-2':[3,4,5],'3-4':[3,4]},'sourcePolicy':'Owner-requested expansion of the public playtest. Original source questions and verified keys; compact worlds where the reviewed pool is thin; both annual boss tests remain reserved.','order':'Reviewed reasoning demand first; source grade and points are secondary signals.'},'worlds':world_plans,'statistics':{'worlds':len(worlds),'questions':len(questions),'bySourceKind':dict(Counter(q['source']['sourceKind'] for q in questions)),'byGrade':dict(Counter(q['source']['gradeBand'] for q in questions)),'byYear':dict(sorted(Counter(q['source']['year'] for q in questions).items(),reverse=True)),'byGradeAndPoints':dict(Counter(f"{q['source']['gradeBand']}:{q['source']['pointTier']}" for q in questions))},'warnings':warnings}
    output.parent.mkdir(parents=True,exist_ok=True)
    assets_dir=output.parent/'assets';assets_dir.mkdir(exist_ok=True)
    for old_asset in assets_dir.iterdir():
        if old_asset.is_file() and old_asset.name not in asset_copies: old_asset.unlink()
    for filename,source_path in asset_copies.items(): shutil.copyfile(source_path, assets_dir/filename)
    output.write_text(json.dumps(runtime,indent=2,ensure_ascii=False)+'\n')
    plan.parent.mkdir(parents=True,exist_ok=True);plan.write_text(json.dumps(plan_data,indent=2,ensure_ascii=False)+'\n')
    return plan_data

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue',type=Path,default=ROOT/'work/math-kangaroo-adaptive-engine/catalogue/corpus-review.sqlite3')
    parser.add_argument('--reviews',nargs='+',type=Path)
    parser.add_argument('--output',type=Path,default=WORK/'runtime/manifest.json')
    parser.add_argument('--plan',type=Path,default=ROOT/'content/math-world/spiral-32.plan.json')
    args=parser.parse_args()
    review_files=args.reviews or sorted(WORK.glob('*-reviewed.json'))
    result=build(args.catalogue.resolve(),review_files,args.output,args.plan)
    print(json.dumps(result['statistics'],indent=2))
