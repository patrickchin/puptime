// Pure Groovy execution of the actual init script with Gradle callbacks stubbed.
// Uses the Groovy/Gradle API jars already included in a Gradle distribution;
// starts no Gradle build, dependency resolution, daemon or Android tooling.
import org.gradle.api.GradleException
import org.codehaus.groovy.control.CompilerConfiguration
import org.codehaus.groovy.control.customizers.ImportCustomizer
import java.nio.file.Files
import java.security.MessageDigest
import groovy.json.JsonSlurper
import org.gradle.api.artifacts.component.*
import org.gradle.internal.component.resolution.failure.exception.ArtifactSelectionException
import org.gradle.internal.component.resolution.failure.interfaces.ArtifactSelectionFailure

class PrivateNoticeFailure extends RuntimeException { String getMessage() { throw new IllegalStateException('PRIVATE_GETTER') } }
class PrivateCauseFailure extends RuntimeException { int reads; Throwable getCause() { reads++; throw new IllegalStateException('PRIVATE_CAUSE_GETTER') } }
class LinkedNoticeFailure extends RuntimeException { int reads; Throwable next; Throwable getCause() { reads++; return next } }
class PrivateResolveFailure extends org.gradle.api.artifacts.ResolveException { PrivateResolveFailure(List<Throwable> causes) { super('PRIVATE_RESOLVE_MESSAGE', causes) } }
class UnknownSelectionFailure extends RuntimeException { int reads; Object getFailure() { reads++; throw new IllegalStateException('PRIVATE_UNKNOWN_GETTER') } }

assert args.length == 1
File source = new File(args[0])
File fixture = Files.createTempDirectory('puptime-notice-gradle-root-').toFile()
try {
    File main = new File(fixture, 'main/android'); main.mkdirs()
    File included = new File(fixture, 'included/android'); included.mkdirs()
    File alias = new File(fixture, 'canonical-alias')
    Files.createSymbolicLink(alias.toPath(), main.toPath())
    def config = new CompilerConfiguration()
    config.addCompilationCustomizers(new ImportCustomizer().addImports('org.gradle.api.GradleException'))
    def execute = { File actual, Object requested, boolean hasApp, Map fault=[:] ->
        def registered = []; int lookups = 0
        def configuration = [resolvedConfiguration: [resolvedArtifacts: []], incoming: [resolutionResult: [allComponents: [iterator: { -> throw fault.failure }, size: { -> 1 }] as Collection]]]
        def app = [findProperty: { name -> new File(main.parentFile, 'build/private-input.json').path }, configurations: [getByName: { name -> if (fault.phase == 'runtime-resolution') throw fault.failure; configuration }], tasks: [register: { name, body ->
            if (fault.phase == 'task-registration') throw fault.failure
            registered.add(name)
            if (fault.runTask) { def task = new Expando(); task.doLast = { action -> action.call() }; body.rehydrate(task, body.owner, body.thisObject).call() }
        }]]
        def target
        target = [projectDir: actual, findProject: { path -> lookups++; if (path != ':app') return path == ':public-library' ? [path: path, rootProject: fault.foreignProject ? new Object() : target] : null; if (fault.phase == 'root-binding') throw fault.failure; hasApp ? app : null }]
        app.rootProject = target; app.path = ':app'
        def properties = requested == null ? [:] : [noticeMainProjectRoot: requested]
        // Included builds need not repeat the main invocation's CLI properties.
        def parent = actual == included ? [startParameter: [projectProperties: properties]] : null
        def invocation = [parent: parent, rootProject: target, startParameter: [projectProperties: parent == null ? properties : [:]], projectsEvaluated: { body -> body.call() }]
        if (fault.diagnostics) target.providers = [environmentVariable: { name -> [orNull: name == 'GITHUB_WORKSPACE' ? main.parentFile.path : name == 'GITHUB_SHA' ? 'a' * 40 : null] }]
        new GroovyShell(this.class.classLoader, new Binding([gradle: invocation]), config).evaluate(source)
        [registered: registered, lookups: lookups]
    }
    assert execute(included, main.path, false) == [registered: [], lookups: 0]
    assert execute(main, main.path, true) == [registered: ['writeNoticeRuntimeInputs'], lookups: 1]
    assert execute(main, alias.path, true) == [registered: ['writeNoticeRuntimeInputs'], lookups: 1]
    for (requested in [main.path, null, 'relative/android', new File(fixture, 'absent').path]) {
        try { execute(main, requested, false); assert false: 'Invalid main root/app must fail' }
        catch (GradleException expected) {
            assert expected.message == (requested == main.path ? 'Missing Android app project' : requested == null || requested == 'relative/android' ? 'Explicit absolute main Android root required' : 'Main Android root does not exist')
        }
    }
    File build = new File(main.parentFile, 'build'), report = new File(build, 'notices/android/failure.json')
    def clear = { if (build.isDirectory()) build.deleteDir(); else build.delete() }
    def entry = { Object item, String kind -> [errorClass: kind, classSHA256: MessageDigest.getInstance('SHA-256').digest(item.getClass().getName().getBytes('UTF-8')).encodeHex().toString()] }
    for (phase in ['root-binding', 'task-registration', 'runtime-resolution', 'artifact-collection']) {
        clear(); def original = phase == 'runtime-resolution' ? new IllegalStateException('PRIVATE_MESSAGE') : new PrivateNoticeFailure(); Throwable caught
        try { execute(main, main.path, true, [phase: phase, failure: original, diagnostics: true, runTask: true]) } catch (Throwable failure) { caught = failure }
        assert caught.is(original)
        def text = report.text, value = new JsonSlurper().parseText(text)
        def kind = phase == 'runtime-resolution' ? 'IllegalStateException' : 'Throwable'
        assert value == [schema: 1, status: 'INCOMPLETE', complete: false, sourceCommit: 'a' * 40, platform: 'android', stage: 'setup', setup: [phase: 'gradle-resolution', errorCategory: 'command-failed', collector: [phase: phase, errorClass: kind, causeChain: [entry(original, kind)], causeChainEnd: 'end']]]
        assert !text.contains('PRIVATE') && !text.contains(fixture.path) && !text.contains('stack')
    }
    def inspect = { Throwable original, List expected, String end, Map selection = null, Map options = [:] ->
        clear(); Throwable caught
        try { execute(main, main.path, true, [phase: 'runtime-resolution', failure: original, diagnostics: true, runTask: true] + options) } catch (Throwable failure) { caught = failure }
        assert caught.is(original)
        def text = report.text, collector = new JsonSlurper().parseText(text).setup.collector
        def wanted = [phase: 'runtime-resolution', errorClass: expected[0].errorClass, causeChain: expected, causeChainEnd: end]
        if (selection != null) wanted.selection = selection
        assert collector == wanted
        assert !text.contains('PRIVATE') && !text.contains(fixture.path) && !text.contains(original.getClass().getName()) && !text.contains('stack')
    }
    def leaf = new IOException('PRIVATE_URL'), nested = new IllegalStateException('PRIVATE_PATH', leaf), sibling = new PrivateCauseFailure()
    def resolved = new PrivateResolveFailure([nested, sibling])
    assert resolved.getCause().is(nested) && resolved.getCauses().size() == 2 // Pinned Gradle exposes the first branch only.
    inspect(resolved, [entry(resolved, 'ResolveException'), entry(nested, 'IllegalStateException'), entry(leaf, 'IOException')], 'end'); assert sibling.reads == 0
    def first = new LinkedNoticeFailure(), second = new LinkedNoticeFailure(); first.next = second; second.next = first
    inspect(first, [entry(first, 'Throwable'), entry(second, 'Throwable')], 'cycle'); assert first.reads == 1 && second.reads == 1
    def unreadable = new PrivateCauseFailure(); inspect(unreadable, [entry(unreadable, 'Throwable')], 'unreadable'); assert unreadable.reads == 1
    def unknown = new PrivateNoticeFailure(); inspect(unknown, [entry(unknown, 'Throwable')], 'end')
    def deep = (1..10).collect { new LinkedNoticeFailure() }; (0..8).each { deep[it].next = deep[it + 1] }
    inspect(deep[0], deep.take(8).collect { entry(it, 'Throwable') }, 'limit'); assert deep.take(8).every { it.reads == 1 } && deep.drop(8).every { it.reads == 0 }
    int selectionChecks = 0
    def selectionCase = { Object component, String kind = null, String identity = null, Map options = [:] ->
        def detail = [getTargetComponent: { component instanceof Closure ? component.call() : component }, getTargetVariant: { throw new PrivateNoticeFailure() }, getRequestedAttributes: { throw new PrivateNoticeFailure() }, describeRequestTarget: { throw new PrivateNoticeFailure() }, getProblemId: { throw new PrivateNoticeFailure() }] as ArtifactSelectionFailure
        def leafFailure = new ArtifactSelectionException('PRIVATE_MESSAGE', detail, []), original = new PrivateResolveFailure([leafFailure])
        def selection = kind == null ? null : [failureClassSHA256: entry(detail, 'Throwable').classSHA256, componentKind: kind, componentSHA256: MessageDigest.getInstance('SHA-256').digest(identity.getBytes('UTF-8')).encodeHex().toString()]
        inspect(original, [entry(original, 'ResolveException'), entry(leafFailure, 'GradleException')], 'end', selection, options); selectionChecks++
        return original
    }
    def reads = [group: 0, module: 0, version: 0]
    def module = [getGroup: { ++reads.group == 1 ? 'qa' : 'PRIVATE_CHANGED' }, getModule: { reads.module++; 'artifact' }, getVersion: { reads.version++; '1' }, getDisplayName: { throw new PrivateNoticeFailure() }] as ModuleComponentIdentifier
    def selectedOriginal = selectionCase(module, 'module', 'maven:qa:artifact@1'); assert reads.values().every { it == 1 }
    def project = { String buildPath, String path -> [getBuild: { [getBuildPath: { buildPath }] as BuildIdentifier }, getProjectPath: { path }, getDisplayName: { throw new PrivateNoticeFailure() }] as ProjectComponentIdentifier }
    selectionCase(project(':', ':app'), 'main-project', 'gradle-project::::app')
    selectionCase(project(':', ':public-library'), 'main-project', 'gradle-project::::public-library')
    selectionCase(project(':other', ':app')); selectionCase(project(':', ':missing')); selectionCase(project(':', ':public-library'), null, null, [foreignProject: true])
    selectionCase([getDisplayName: { throw new PrivateNoticeFailure() }] as ComponentIdentifier); selectionCase(null)
    selectionCase([getGroup: { throw new PrivateNoticeFailure() }, getModule: { 'artifact' }, getVersion: { '1' }] as ModuleComponentIdentifier)
    selectionCase([getGroup: { 'x' * 513 }, getModule: { 'artifact' }, getVersion: { '1' }] as ModuleComponentIdentifier)
    selectionCase({ throw new PrivateNoticeFailure() })
    def unknownSelection = new UnknownSelectionFailure(); inspect(unknownSelection, [entry(unknownSelection, 'Throwable')], 'end'); assert unknownSelection.reads == 0; selectionChecks++
    def detail = [getTargetComponent: { module }] as ArtifactSelectionFailure, innerSelection = new ArtifactSelectionException('PRIVATE_INNER', detail, []), outerSelection = new ArtifactSelectionException('PRIVATE_OUTER', detail, [], innerSelection), competing = new PrivateResolveFailure([outerSelection])
    inspect(competing, [entry(competing, 'ResolveException'), entry(outerSelection, 'GradleException'), entry(innerSelection, 'GradleException')], 'end'); selectionChecks++
    clear(); build.text = 'PRIVATE_WRITER_BLOCKER'; Throwable selectedCaught
    try { execute(main, main.path, true, [phase: 'runtime-resolution', failure: selectedOriginal, diagnostics: true, runTask: true]) } catch (Throwable failure) { selectedCaught = failure }
    assert selectedCaught.is(selectedOriginal) && !report.exists(); build.delete(); selectionChecks++
    for (blocked in ['file', 'symlink']) {
        clear(); if (blocked == 'file') build.text = 'PRIVATE_BLOCKER'; else Files.createSymbolicLink(build.toPath(), new File(fixture, 'outside').tap { mkdirs() }.toPath())
        def original = new IllegalArgumentException('PRIVATE_ORIGINAL'); Throwable caught
        try { execute(main, main.path, true, [phase: 'runtime-resolution', failure: original, diagnostics: true, runTask: true]) } catch (Throwable failure) { caught = failure }
        assert caught.is(original) && !report.exists()
        build.delete()
    }
    println "Actual init source: 7 root guards +4 finite Throwable phases +5 bounded cause chains +${selectionChecks} selection cases +2 failed/outside writers PASS; no Gradle build."
} finally { fixture.deleteDir() }
