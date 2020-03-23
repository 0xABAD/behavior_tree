//@ts-check

const expect = require('chai').expect;
const fs = require('fs');
// the `bt` is used by the README.md samples that are tested below
const bt = require('../btree').bt;
const { BehaviorTree, parse,
    Fallback, Sequence, Parallel, Action, Condition,
    FALLBACK, SEQUENCE, PARALLEL, ACTION, CONDITION,
    fallback, sequence, parallel, action, condition,
    SUCCESS, FAILED, RUNNING, FINISHED,
    SAMPLE_TREE, getFriendlyStatus,
    parseComment } = bt;

describe('README.md samples', () => {
    it('runs all samples from README.md', () => {

        let fenceStart = new RegExp(/^```(.+)$/, "gm");
        let fenceEnd = new RegExp(/^```$/, "gm");

        let readme = fs.readFileSync('./README.md', { encoding: 'utf8' });
        /** @type {RegExpExecArray} */
        let startMatch = null;
        while ((startMatch = fenceStart.exec(readme)) !== null) {
            let language = startMatch[1];
            let fencedTextStartIdx = startMatch.index + startMatch[0].length + 1;
            fenceEnd.lastIndex = fencedTextStartIdx;

            let endMatch = fenceEnd.exec(readme);
            if (endMatch === null) {
                break;
            }
            fenceStart.lastIndex = endMatch.index + endMatch[0].length + 1;
            let fencedText = readme.substring(fencedTextStartIdx, endMatch.index);
            // console.log(`${language}: ${fencedText}`);
            checkSample(language, fencedText);
        }
    });

    it('parses the `sample.tree` file', () => {
        let sample = fs.readFileSync('./sample.tree', { encoding: 'utf8' });
        let tree = parse(sample);
        expect(tree.error).to.be.null;
        expect(tree.root).to.be.not.null;
        expect(tree.root.kind).to.be.equal(FALLBACK);
    });
})

/**
 * Check the code sample
 * @param {string} language code language
 * @param {string} sampleCode
 */
function checkSample(language, sampleCode) {
    switch (language.toLowerCase()) {
        case 'tree':
            let tree = parse(sampleCode);
            expect(tree.root).to.be.not.null;
            expect(tree.error, `there should be no error in tree sample ${sampleCode}`).to.be.null;
            break;
        case 'javascript':
            const { JSDOM } = require("jsdom");
            // mock the document
            var document = new JSDOM(`<div id="tree-host"/>`).window.document;
            // mock the function, so the sample can run
            var showTree = function (arg1, arg2, arg3, arg4) {
                return () => { };
            }; 
            const runSample = () => {
                eval(sampleCode);
            }
            expect(runSample, `sample: ${sampleCode}`).to.not.throw();
            break;
        default:
            console.warn(`Language ${language} not supported for checking.`);
    }
}

describe('#parse', () => {

    context('valid input', () => {
        it('parses sample', () => {
            let tree = parse(SAMPLE_TREE);
            expect(tree.root).to.be.not.null;
            expect(tree.error).to.be.null;
            expect(tree.conditions.get('Ghost Scared')).to.have.length(2);
            expect(tree.actions.get('Avoid Ghost')).to.have.length(1);
        });
    });

    context('comments', () => {
        it('ignores full line comment', () => {
            let tree = parse(`;; this is a comment
            ->`);
            expect(tree.error).to.be.null;
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(SEQUENCE);
        });

        it('parses comment', () => {
            const expectedComment = 'this is a comment';
            const [i, comment, err] = parseComment(`;; ${expectedComment}
            ->`, 1);
            expect(err).to.be.null;
            expect(comment).to.be.not.null;
            expect(comment).to.be.equal(expectedComment);
        });

        it('ignores trailing comments', () => {
            let tree = parse(`-> ;; this is a comment`);
            expect(tree.error).to.be.null;
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(SEQUENCE);
        });

        it('enforces double semicolon', () => {
            let tree = parse(`; this is a wrong comment`);
            expect(tree.error).to.be.not.null;
            expect(tree.line).to.be.equal(1);
            expect(tree.error).to.contain(';;'); // should indicate how to write comments
        });
    });

    context('for single-node tree', () => {
        it('parses fallback', () => {
            let tree = parse(`?`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(FALLBACK);
        });

        it('parses sequence', () => {
            let tree = parse(`->`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(SEQUENCE);
        });

        it('parses parallel', () => {
            let count = 12;
            let tree = parse(`=${count}`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(PARALLEL);
            /** @type {Parallel} */
            let actualParallel = tree.root;
            expect(actualParallel.successCount).to.be.equal(count);
        });

        it('parses condition', () => {
            let conditionName = 'condition1';
            let tree = parse(`(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses negated condition', () => {
            let conditionName = 'condition1';
            let tree = parse(`!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(true);
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses double-negated condition', () => {
            let conditionName = 'condition1';
            let tree = parse(`!!(${conditionName})`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(CONDITION);
            expect(tree.root.name).to.be.equal(conditionName);
            expect(tree.root.hasNot).to.be.equal(false);
            expect(tree.conditions.get(conditionName)).to.be.deep.equal([tree.root]);
        });

        it('parses action', () => {
            let actionName = 'action name';
            let tree = parse(`[${actionName}]`);
            expect(tree.root).to.be.not.null;
            expect(tree.root.kind).to.be.equal(ACTION);
            expect(tree.root.name).to.be.equal(actionName);
            expect(tree.actions.get(actionName)).to.be.deep.equal([tree.root]);
        });
    });

    context('for invalid input', () => {
        it('returns error for empty string', () => {
            let tree = parse('');
            expect(tree.root).to.equal(null);
            expect(tree.error).to.not.equal(null, "there should be error message");
        });

        it('returns error for double root', () => {
            let tree = parse(`->
                |   (some condition)
                ->
                |   (some other condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.not.equal(null, "there should be error message");
        });

        it('returns error for double indent (orphan tree branches)', () => {
            let tree = parse(`->
                |   |   (some condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("indentation", "there should be error message");
        });

        it('returns error for child of condition', () => {
            let tree = parse(`(condition)
                |   (some other condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });

        it('returns error for child of action', () => {
            let tree = parse(`[action]
                |   (some condition)
                `);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });

        it('returns error for lack of root tree level', () => {
            let tree = parse(`|   [action1]`);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("no parent", "there should be error message");
        });

        // todo: decide whether the syntax should allow this
        it.skip('returns error for two nodes on the same line', () => {
            let tree = parse(`->  [action1]`);
            expect(tree.root).to.equal(null);
            expect(tree.error).to.contain("can't have child nodes", "there should be error message");
        });
    });
});

describe("BehaviorTree", () => {
    describe("#fromJson", () => {
        it('builds tree from JSON', () => {
            let tree = BehaviorTree.fromJson(JSON.parse(`{
                "root":{
                    "name": "Avoid Ghost",
                    "kind": "action",
                    "children": null,
                    "active": false,
                    "wasActive": false,
                    "nodeStatus": 2,
                    "hasNot": false
                }
            }`));
            expect(tree.root.kind).to.be.equal(ACTION);
        });

        it('parses sample and re-hydrates it from JSON', () => {
            let tree = parse(SAMPLE_TREE);
            tree.root.tick();
            let treeAsString = JSON.stringify(tree);
            let treeAsJson = JSON.parse(treeAsString);
            // when
            let actualTree = BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(JSON.stringify(actualTree)).equal(treeAsString);
        });

        it('re-hydrates true condition from JSON with correct value', () => {
            let conditionName = 'condition1';
            let tree = parse(`(${conditionName})`);
            tree.setConditionStatus(conditionName, SUCCESS);
            tree.root.tick();
            let treeAsString = JSON.stringify(tree);
            let treeAsJson = JSON.parse(treeAsString);
            // when
            let actualTree = BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(actualTree.root.status()).equal(SUCCESS, "condition value should be SUCCESS");
        });

        it('re-hydrates a running action from JSON with correct status', () => {
            let actionName = 'action1';
            let tree = parse(`[${actionName}]`);
            tree.setActionStatus(actionName, RUNNING);
            tree.root.tick();
            let treeAsString = JSON.stringify(tree);
            let treeAsJson = JSON.parse(treeAsString);
            // when
            let actualTree = BehaviorTree.fromJson(treeAsJson);
            actualTree.root.tick();
            // then
            expect(actualTree.root.status()).equal(RUNNING, "action status should be RUNNING");
            expect(actualTree.root.active()).equal(true, "action status should be 'active'");
        });
    });

    describe('#tick', () => {
        it('notify about action activation when ticked', () => {
            let action1 = action("action1");
            let tree = new BehaviorTree(action1, 0, undefined);
            // when
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        it('notify about action activation when ticked (in parsed tree)', () => {
            let tree = parse(`[a]`);
            expect(tree.root.kind).to.be.equal(ACTION);
            // when
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });

        it('notify about action activation when ticked (in JSON tree)', () => {
            let tree = BehaviorTree.fromJson(JSON.parse(`{
                "root":{
                    "name": "Avoid Ghost",
                    "kind": "action",
                    "children": null,
                    "active": false,
                    "wasActive": false,
                    "nodeStatus": 2,
                    "hasNot": false
                }
            }`));
            expect(tree.root.kind).to.be.equal(ACTION);
            // when
            let actualActivatedAction = null;
            tree.onActionActivation(actionNode => actualActivatedAction = actionNode);
            tree.root.tick();
            // then
            expect(tree.root.status()).equal(RUNNING);
            expect(tree.root.active()).equal(true);
            expect(actualActivatedAction).equal(tree.root);
        });


        it('executes a sample parsed tree', () => {
            let tree = BehaviorTree.fromText(`
            ?
            |   !(have hunger)
            |   [eat]`);

            // subscribe to action activation
            tree.onActionActivation(actionNode => {
                switch (actionNode.name) {
                    case 'eat':
                        console.log(getFriendlyStatus(actionNode.status())); // prints 'running'
                        if (actionNode.active()) { // in general we should check that the action is in an active branch
                            console.log('Started eating...');
                            // no longer hungry!
                            tree.setConditionStatus('have hunger', FAILED);
                            console.log('Done eating...');
                            tree.setActionStatus('eat', SUCCESS);
                        }
                }
            });
            tree.root.tick();

            console.log('Initial state:');
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
            console.log(tree.root.active()); // prints true

            // then we get hunger
            tree.setConditionStatus('have hunger', SUCCESS);
            let statusAfterHungerIsTrue = tree.root.tick();
            console.log(getFriendlyStatus(statusAfterHungerIsTrue)); // prints 'success', because the action was executed synchronously as part of the tick

            // now 'Eating...' should be printed

            // final state:
            tree.root.tick();
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
        });

        it('executes a sample coded tree', () => {

            // define the action 'eat' implementation
            let onEat = function (actionNode) {
                switch (actionNode.name) {
                    case 'eat':
                        console.log(getFriendlyStatus(actionNode.status())); // prints 'running'
                        if (actionNode.active()) { // in general we should check that the action is in an active branch
                            console.log('Started eating...');
                            // no longer hungry!
                            tree.setConditionStatus('have hunger', FAILED);
                            console.log('Done eating...');
                            tree.setActionStatus('eat', SUCCESS);
                        }
                }
            };

            // ?
            // |   !(have hunger)
            // |   [eat]`

            let rootNode = fallback([
                condition("have hunger", true),
                action("eat", onEat)
            ]);
            let tree = new BehaviorTree(rootNode);

            tree.root.tick();

            console.log('Initial state:');
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
            console.log(tree.root.active()); // prints true

            // then we get hunger
            tree.setConditionStatus('have hunger', SUCCESS);
            let statusAfterHungerIsTrue = tree.root.tick();
            console.log(getFriendlyStatus(statusAfterHungerIsTrue)); // prints 'success', because the action was executed synchronously as part of the tick

            // now 'Eating...' should be printed

            // final state:
            tree.root.tick();
            console.log(getFriendlyStatus(tree.root.status())); // prints 'success'
        });

    });
});

describe('#fallback', () => {
    it('resolves to FAILED when no children', () => {
        let tree = parse(`?`);
        expect(tree.root).to.be.not.null;
        expect(tree.root.kind).to.be.equal(FALLBACK);
        // when
        tree.root.tick();
        expect(tree.root.status()).equal(FAILED);
    });
});

describe('Action', () => {
    describe('#tick', () => {
        it('runs action when ticked', () => {
            let action1 = action("action1", actionNode => actualActivatedAction = actionNode);
            // when
            let actualActivatedAction = null;
            action1.tick();
            // then
            expect(action1.status()).equal(RUNNING);
            expect(action1.active()).equal(true);
            expect(action1.wasActive).equal(false);
            expect(actualActivatedAction).deep.equal(action1);
        });
    });

    describe('#wasActive', () => {
        it('re-activates previously active action', () => {
            let action1 = action("action1", actionNode => actualActivatedActions.push(actionNode));
            // when
            let actualActivatedActions = [];
            action1.tick();
            // then
            expect(action1.status()).equal(RUNNING);
            expect(action1.active()).equal(true);
            expect(action1.wasActive).equal(false);
            expect(actualActivatedActions).contains(action1);
            // when .. action is finished
            action1.setStatus(FINISHED);
            action1.deactivate(); // simulate that another tree branch became active
            // then
            expect(action1.status()).equal(FINISHED);
            expect(action1.active()).equal(false);
            expect(action1.wasActive).equal(true);
        });
    });
});
