import test from 'node:test';
import assert from 'node:assert/strict';
const modulePromise = import('../frontend/src/eng/engReadingAnchor.js');
const keyOf = item => item.key;
test('only one Epic retains its slot while canonical peers sort', async () => {
    const { projectEngEpicOrder } = await modulePromise;
    const items = ['E5', 'E1', 'E2', 'E3', 'E4'].map(key => ({ key }));
    assert.deepEqual(projectEngEpicOrder(items, 'E4', 3, keyOf).map(keyOf), ['E5', 'E1', 'E2', 'E4', 'E3']);
    for (const slot of [undefined, null, 1.5]) assert.equal(projectEngEpicOrder(items, 'E4', slot, keyOf), items);
    assert.deepEqual(items.map(keyOf), ['E5', 'E1', 'E2', 'E3', 'E4']);
});
test('complete held Story/requirement order survives removal with additions appended', async () => {
    const { projectEngReadingOrder } = await modulePromise;
    const items = ['NEW', 'S3', 'REQ', 'S1'].map(key => ({ key }));
    assert.deepEqual(projectEngReadingOrder(items, ['S1', 'S2', 'REQ', 'S3'], keyOf).map(keyOf), ['S1', 'REQ', 'S3', 'NEW']);
    assert.deepEqual(items.map(keyOf), ['NEW', 'S3', 'REQ', 'S1']);
});
test('restore clamps one actual container, preserves horizontal scroll and fences movement', async () => {
    const { restoreEngReadingAnchor } = await modulePromise;
    const container = { scrollTop: 100, scrollHeight: 1000, clientHeight: 400, scrollLeft: 73 };
    let top = 190;
    const node = { getBoundingClientRect: () => ({ top }) };
    const anchor = { offsetTop: 140, movementEpoch: 2, scopeKey: 'scope', container: 'panel-body' };
    const access = { node, container, bounds: { top: 0 }, movementEpoch: 2, scopeKey: 'scope' };
    assert.equal(restoreEngReadingAnchor(anchor, access), 50);
    assert.equal(container.scrollTop, 150); assert.equal(container.scrollLeft, 73);
    top = 140; assert.equal(restoreEngReadingAnchor(anchor, access), 0);
    top = 190; assert.equal(restoreEngReadingAnchor(anchor, { ...access, movementEpoch: 3 }), 0);
    assert.equal(container.scrollTop, 150);
    assert.equal(restoreEngReadingAnchor(anchor, { ...access, scopeKey: 'second-navigation' }), 0);
});
test('two-frame settlement completes before a second capture and ignores deliberate movement', async () => {
    const helper = await modulePromise;
    const callbacks = [], events = new Map();
    let top = 200;
    const node = { dataset: { taskKey: 'S1' }, isConnected: true, classList: { contains: () => false }, closest: () => null, getBoundingClientRect: () => ({ top, bottom: top + 30 }) };
    const root = { querySelectorAll: () => [node], activeElement: null, visibilityState: 'visible', scrollingElement: { scrollHeight: 2000 }, addEventListener: (name, callback) => events.set(name, callback), removeEventListener() {} };
    const win = { document: root, scrollY: 100, scrollX: 71, innerHeight: 600, scrollTo(x, y) { this.scrollX = x; top -= y - this.scrollY; this.scrollY = y; }, requestAnimationFrame: callback => callbacks.push(callback), setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
    globalThis.document = root; globalThis.window = win;
    const cleanup = helper.installEngReadingEvents(root, win, () => ({ top: 100, bottom: 600 }));
    const input = { surface: 'catch_up', scopeKey: 'scope', viewport: { top: 100, bottom: 600 }, state: { productTasks: [], techTasks: [] } };
    const anchor = helper.beginEngReadingCommit(input);
    assert.equal(anchor.offsetTop, 200, 'window origin is independent of sticky visible bounds');
    top -= 50; input.viewport.top = 150;
    let settled = false;
    const pending = helper.finishEngReadingCommit(anchor, input).then(() => { settled = true; });
    assert.equal(settled, false); callbacks.shift()(); assert.equal(settled, false); callbacks.shift()(); await pending;
    assert.equal(top, 200); assert.equal(win.scrollX, 71);
    const second = helper.beginEngReadingCommit(input); top = 180;
    const moving = helper.finishEngReadingCommit(second, input);
    events.get('wheel')({ type: 'wheel' }); callbacks.shift()(); callbacks.shift()(); await moving;
    assert.equal(top, 180, 'new user position is not restored');
    const third = helper.beginEngReadingCommit(input);
    const direct = helper.finishEngReadingCommit(third, input);
    win.scrollY += 20; top -= 20; events.get('scroll')();
    callbacks.shift()(); callbacks.shift()(); await direct;
    assert.equal(top, 160, 'direct scrollbar/navigation movement is not restored');
    cleanup(); assert.equal(helper.getEngReadingPresentation(), null);
    delete globalThis.document; delete globalThis.window;
});

test('presentation departure does not enter canonical Story count or mutate source groups', async () => {
    const {buildEngWorkHierarchy}=await import('../frontend/src/eng/engWorkHierarchy.js');
    const task={key:'S1',fields:{epicKey:'E1',customfield_10004:3}};
    const departed={key:'S0',fields:{epicKey:'E1',customfield_10004:99}};
    const groups=[{key:'E1',epic:{key:'E1'},tasks:[task],storyPoints:3}];
    const hierarchy=buildEngWorkHierarchy({storyEpicGroups:groups,readingPresentation:{epicKey:'E1',slot:0,storyKeys:['S0','S1'],departure:departed}});
    assert.equal(hierarchy.counts.realStories,1);assert.equal(hierarchy.counts.visibleRows,1);
    assert.deepEqual(hierarchy.canonicalEpicGroups[0].rows.map(row=>row.id),['S1']);
    assert.deepEqual(hierarchy.epicGroups[0].tasks,[task]);assert.equal(hierarchy.epicGroups[0].rows[0].readingDeparture,true);
    assert.deepEqual(groups[0].tasks,[task]);
});
test('table Story projection holds the complete one-Epic order while peers retain canonical order', async () => {
    const {projectEngTableReadingOrder}=await modulePromise;
    const rows=[{id:'new',epicKey:'E1'},{id:'p2',epicKey:'E2'},{id:'s2',epicKey:'E1'},{id:'req',epicKey:'E1'},{id:'s1',epicKey:'E1'},{id:'p1',epicKey:'E3'}];
    const pin={epicKey:'E1',rowKey:'s1',slot:0,storyKeys:['s1','req','s2']};
    const shown=projectEngTableReadingOrder(rows,pin,'story');
    assert.deepEqual(shown.filter(row=>row.epicKey==='E1').map(row=>row.id),['s1','req','s2','new']);
    assert.deepEqual(shown.filter(row=>row.epicKey!=='E1').map(row=>row.id),['p2','p1']);
    assert.deepEqual(rows.map(row=>row.id),['new','p2','s2','req','s1','p1']);
});
test('middle table reading row never reverses the held Epic Story order', async () => {
    const {projectEngTableReadingOrder}=await modulePromise;
    const rows=['new','s2','p','s1','req'].map(id=>({id,epicKey:id==='p'?'E2':'E1'}));
    const shown=projectEngTableReadingOrder(rows,{epicKey:'E1',rowKey:'s2',slot:3,storyKeys:['s1','req','s2']},'story');
    assert.deepEqual(shown.filter(row=>row.epicKey==='E1').map(row=>row.id),['s1','req','s2','new']);
    assert.equal(shown[3].id,'s2');
});
test('table capture ignores synthetic group and requirement placeholders', async () => {
    const {captureEngReadingAnchor}=await modulePromise;
    const row=(kind,key,synthetic=false)=>({dataset:{planningRowKey:key,rowKind:kind,epicKey:kind==='story'?'E1':undefined},isConnected:true,classList:{contains:className=>synthetic && className==='planning-review-synthetic'},closest:()=>null,getBoundingClientRect:()=>({top:200,bottom:240})});
    const nodes=[row('group','no-epic'),row('requirement','req'),row('epic','placeholder',true),row('story','real')];
    const root={querySelectorAll:()=>nodes},win={};
    const anchor=captureEngReadingAnchor({root,win,surface:'planning',scopeKey:'scope',viewport:{top:100,bottom:600}});
    assert.equal(anchor.key,'real');
});

function mountedReading(helper, table = false) {
    const events = new Map(), frames = new Map(), timers = new Map(); let nextId = 0;
    const node = { dataset: table ? {planningRowKey:'1001',issueKey:'STORY-1',rowKind:'story',epicKey:'E1'} : {taskKey:'STORY-1',epicKey:'E1'}, isConnected:true, classList:{contains:()=>false}, closest:()=>null, getBoundingClientRect:()=>({top:200,bottom:230}) };
    node.parentElement = {children:[node]};
    const root = {querySelectorAll:()=>[node],visibilityState:'visible',scrollingElement:{scrollHeight:2000},addEventListener:(name,cb)=>events.set(name,cb),removeEventListener:name=>events.delete(name)};
    const win = {document:root,scrollY:100,scrollX:70,innerHeight:600,scrollTo(){throw Error('cancelled settlement must not scroll');},requestAnimationFrame:cb=>{const id=++nextId;frames.set(id,cb);return id;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:cb=>{const id=++nextId;timers.set(id,cb);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,cb)=>events.set(name,cb),removeEventListener:name=>events.delete(name)};
    globalThis.document=root;globalThis.window=win;
    const cleanup=helper.installEngReadingEvents(root,win,()=>({top:100,bottom:600}));
    const input={surface:'planning',scopeKey:'scope',viewport:{top:100,bottom:600},state:{productTasks:[{key:'STORY-1',id:'1001',fields:{epicKey:'E1'}}]}};
    return {input,events,frames,timers,cleanup:()=>{cleanup();delete globalThis.document;delete globalThis.window;}};
}
test('table geometry ID resolves a distinct issue key for read-only departure', async()=>{
    const helper=await modulePromise, mounted=mountedReading(helper,true);
    try {
        helper.setEngReadingTableRows([{id:'1001',key:'STORY-1',rowKind:'story',epicKey:'E1'}]);
        const anchor=helper.beginEngReadingCommit(mounted.input);
        assert.equal(anchor.key,'1001');
        helper.markEngReadingDeparture(new Set());
        assert.equal(helper.getEngReadingPresentation().departure?.key,'STORY-1');
    } finally {helper.setEngReadingTableRows([]);mounted.cleanup();}
});
test('release and unmount cancel frames/timers and resolve pending settlement',async()=>{
    const helper=await modulePromise;
    for(const unmount of [false,true]) {
        const mounted=mountedReading(helper);
        try {
            const anchor=helper.beginEngReadingCommit(mounted.input);
            let resolved=false;
            const pending=helper.finishEngReadingCommit(anchor,mounted.input).then(()=>{resolved=true;});
            const dispatchedFrame=[...mounted.frames.values()][0];
            if(unmount) mounted.cleanup();else helper.releaseEngReadingContext();
            dispatchedFrame();
            await Promise.resolve();
            assert.equal(resolved,true,'retirement resolves immediately without another frame');
            assert.equal(mounted.frames.size,0);assert.equal(mounted.timers.size,0);await pending;
        } finally {if(!unmount) mounted.cleanup();}
    }
});
test('resize visibility uses current measured owner bounds without a new commit',async()=>{
    const helper=await modulePromise,mounted=mountedReading(helper);let top=100;
    try {
        const unregister=helper.setEngReadingViewportReader(()=>({top,bottom:600}));
        helper.beginEngReadingCommit(mounted.input);
        mounted.events.get('resize')();
        assert.notEqual(helper.getEngReadingPresentation(),null,'resize still sees old owner measurement');
        top=210;helper.recheckEngReadingVisibility();
        assert.notEqual(helper.getEngReadingPresentation(),null,'committed bounds still intersecting row retain reading');
        top=240;helper.recheckEngReadingVisibility();
        assert.equal(helper.getEngReadingPresentation(),null,'later owner measurement commit releases row behind sticky stack');unregister();
    } finally {mounted.cleanup();}
});
test('ungrouped reading Epic retains its slot alongside grouped Initiative Epics',async()=>{
    const {buildEngWorkHierarchy}=await import('../frontend/src/eng/engWorkHierarchy.js');
    const groups=['E3','E2','E1'].map(key=>({key,epic:{key,initiative:key==='E3'?{key:'I1',summary:'Grouped'}:undefined},tasks:[]}));
    const model=buildEngWorkHierarchy({storyEpicGroups:groups,groupByInitiative:true,readingPresentation:{epicKey:'E1',groupKey:null,slot:0,storyKeys:[]}});
    assert.deepEqual(model.initiativeGroups.find(group=>!group.initiative).epicGroups.map(group=>group.key),['E1','E2']);
    assert.deepEqual(model.initiativeGroups.find(group=>group.initiative).epicGroups.map(group=>group.key),['E3']);
});
test('departed table Story retains distinct geometry ID in presentation only at its held slot',async()=>{
    const {projectEngTableReadingOrder}=await modulePromise;
    const rows=[{id:'101',key:'S1',epicKey:'E1'},{id:'103',key:'S3',epicKey:'E1'},{id:'201',key:'PEER',epicKey:'E2'}];
    const task={id:'102',key:'S2',fields:{epicKey:'E1',customfield_10004:99}};
    const pin={epicKey:'E1',rowKey:'102',slot:1,storyKeys:['101','102','103'],departure:task};
    const shown=projectEngTableReadingOrder(rows,pin,'story');
    assert.deepEqual(shown.map(row=>row.id),['101','102','103','201']);
    assert.equal(shown[1].readingDeparture,true);assert.equal(shown[1].issue,task);assert.equal(shown[1].key,'S2');
    assert.deepEqual(rows.map(row=>row.id),['101','103','201']);
    assert.equal(projectEngTableReadingOrder(rows,null,'story'),rows,'revoked pin has no retained row');
});
test('table Epic departure uses flat issue snapshot and canonical Epic membership',async()=>{
    const helper=await modulePromise,mounted=mountedReading(helper,true);
    try {
        const issue={id:'1001',key:'E1',summary:'Authorized Epic',status:{name:'To Do'}};
        helper.setEngReadingTableRows([{id:'1001',key:'E1',rowKind:'epic',issue}]);
        helper.beginEngReadingCommit(mounted.input);
        helper.markEngReadingDeparture(new Set(),[],new Set(['E1']));
        assert.equal(helper.getEngReadingPresentation().departure,null,'existing Epic is not compared with Story keys');
        helper.markEngReadingDeparture(new Set(),[],new Set());
        const pin=helper.getEngReadingPresentation();assert.equal(pin.departure.key,'E1');assert.equal(pin.departure.fields.summary,'Authorized Epic');
        const rows=[{id:'peer',key:'E2',rowKind:'epic'}];const shown=helper.projectEngTableReadingOrder(rows,pin,'epic');
        assert.equal(shown[0].id,'1001');assert.equal(shown[0].readingDeparture,true);assert.equal(rows.length,1);
        helper.markEngReadingDeparture(new Set(),['E1'],new Set());assert.equal(helper.getEngReadingPresentation(),null);
    } finally {helper.setEngReadingTableRows([]);mounted.cleanup();}
});
test('nested read-only card shares outer numeric table identity for capture and interaction',async()=>{
    const helper=await modulePromise,mounted=mountedReading(helper,true);
    try {
        const outer=document.querySelectorAll()[0];
        const inner={dataset:{taskKey:'STORY-1'},isConnected:true,classList:{contains:()=>false},closest:selector=>selector==='[data-planning-row-key]'?outer:null,getBoundingClientRect:outer.getBoundingClientRect};
        document.querySelectorAll=()=>[inner,outer];document.activeElement={closest:()=>inner};
        helper.setEngReadingTableRows([{id:'1001',key:'STORY-1',rowKind:'story'}]);
        const anchor=helper.beginEngReadingCommit(mounted.input);assert.equal(anchor.key,'1001');assert.equal(anchor.kind,'row');
        mounted.events.get('pointerdown')({type:'pointerdown',target:{closest:selector=>selector.startsWith('[data-status')?null:inner}});
        assert.notEqual(helper.getEngReadingPresentation(),null,'same nested reading card does not release');
        const other={dataset:{planningRowKey:'1002',rowKind:'story',epicKey:'E1'},closest:()=>null};
        mounted.events.get('pointerdown')({type:'pointerdown',target:{closest:selector=>selector.startsWith('[data-status')?null:other}});
        assert.equal(helper.getEngReadingPresentation(),null,'different row releases immediately');
    } finally {helper.setEngReadingTableRows([]);mounted.cleanup();}
});
test('explicit denied issue identity clears a no-Epic table reading snapshot',async()=>{
    const helper=await modulePromise,mounted=mountedReading(helper,true);
    try {
        const node=document.querySelectorAll()[0];delete node.dataset.epicKey;
        helper.setEngReadingTableRows([{id:'1001',key:'STORY-1',rowKind:'story'}]);
        helper.beginEngReadingCommit(mounted.input);
        helper.beginEngReadingCommit({...mounted.input,deniedIssueKeys:['STORY-1']});
        assert.equal(helper.getEngReadingPresentation(),null,'numeric ID does not conceal denied issue identity');
    } finally {helper.setEngReadingTableRows([]);mounted.cleanup();}
});
test('equivalent canonical Epic clones do not republish the reading store',async()=>{
    const helper=await modulePromise,mounted=mountedReading(helper,true);
    try {
        const issue={id:'1001',key:'E1',summary:'Same Epic'};
        helper.setEngReadingTableRows([{id:'1001',key:'E1',rowKind:'epic',issue}]);helper.beginEngReadingCommit(mounted.input);
        const before=helper.getEngReadingPresentation();helper.setEngReadingTableRows([{id:'1001',key:'E1',rowKind:'epic',issue:{...issue}}]);
        assert.equal(helper.getEngReadingPresentation(),before);
        helper.setEngReadingTableRows([{id:'1001',key:'E1',rowKind:'epic',issue:{...issue,summary:'Authorized current summary'}}]);
        assert.equal(helper.getEngReadingPresentation().task.fields.summary,'Authorized current summary');
    } finally {helper.setEngReadingTableRows([]);mounted.cleanup();}
});
test('private source origins retire cumulatively and current accepted support can restore an origin',async()=>{
    const helper=await modulePromise,mounted=mountedReading(helper,true);
    try {
        const task=mounted.input.state.productTasks[0];
        helper.setEngReadingTableRows([{id:'1001',key:task.key,rowKind:'story',issue:task}]);
        const first={...mounted.input,state:{productTasks:[task],techTasks:[task]}};
        helper.beginEngReadingCommit(first);assert.deepEqual(helper.getEngReadingPresentation().originLanes,['product','tech']);
        helper.markEngReadingDeparture(new Set());
        const departed={...mounted.input,state:{productTasks:[],techTasks:[]}};
        helper.beginEngReadingCommit({...departed,deniedLanes:['product']});assert.deepEqual(helper.getEngReadingPresentation().originLanes,['tech']);
        helper.beginEngReadingCommit({...departed,deniedLanes:['tech']});assert.equal(helper.getEngReadingPresentation(),null,'later lane-only denial cannot resurrect denied product origin');
        helper.beginEngReadingCommit(first);helper.markEngReadingDeparture(new Set());
        helper.beginEngReadingCommit({...departed,deniedLanes:['product']});
        helper.beginEngReadingCommit({...departed,deniedLanes:['tech'],acceptedSourceKeys:{product:[task.key]}});
        assert.deepEqual(helper.getEngReadingPresentation().originLanes,['product'],'current accepted support restores only its actual lane');
    } finally {helper.setEngReadingTableRows([]);mounted.cleanup();}
});

test('one document correction includes compact-header removal when crossing the main header', async () => {
    const { restoreEngReadingAnchor } = await modulePromise;
    let top = 483.09375, calls = 0;
    const compact = { getBoundingClientRect: () => ({ height: 52.578125 }) };
    const header = { getBoundingClientRect: () => ({ bottom: -40.59375 }) };
    const win = {
        scrollY: 166, scrollX: 71, innerHeight: 1000,
        document: { scrollingElement: { scrollHeight: 3000 }, querySelector: selector => selector === 'header' ? header : compact },
        getComputedStyle: () => ({ marginTop: '0px', marginBottom: '13.484375px' }),
        scrollTo(x, y) { calls++; top -= y - this.scrollY + 66.0625; this.scrollY = y; this.scrollX = x; },
    };
    const anchor = { container: 'window', offsetTop: 565.984375, movementEpoch: 2, scopeKey: 'scope' };
    restoreEngReadingAnchor(anchor, { node: { getBoundingClientRect: () => ({ top }) }, bounds: { top: 0 }, movementEpoch: 2, scopeKey: 'scope', win });
    assert.equal(calls, 1); assert.equal(top, anchor.offsetTop); assert.equal(win.scrollX, 71);
});
