// Pure Groovy execution of the actual init script with Gradle callbacks stubbed.
// Uses the Groovy/Gradle API jars already included in a Gradle distribution;
// starts no Gradle build, dependency resolution, daemon or Android tooling.
import org.gradle.api.GradleException
import org.codehaus.groovy.control.CompilerConfiguration
import org.codehaus.groovy.control.customizers.ImportCustomizer
import java.nio.file.Files
import groovy.json.JsonSlurper

class PrivateNoticeFailure extends RuntimeException { String getMessage() { throw new IllegalStateException('PRIVATE_GETTER') } }

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
        def target = [projectDir: actual, findProject: { path -> assert path == ':app'; lookups++; if (fault.phase == 'root-binding') throw fault.failure; hasApp ? app : null }]
        def properties = requested == null ? [:] : [noticeMainProjectRoot: requested]
        // Included builds need not repeat the main invocation's CLI properties.
        def parent = actual == included ? [startParameter: [projectProperties: properties]] : null
        def invocation = [parent: parent, rootProject: target, startParameter: [projectProperties: parent == null ? properties : [:]], projectsEvaluated: { body -> body.call() }]
        if (fault.diagnostics) invocation.providers = [environmentVariable: { name -> [orNull: name == 'GITHUB_WORKSPACE' ? main.parentFile.path : name == 'GITHUB_SHA' ? 'a' * 40 : null] }]
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
    for (phase in ['root-binding', 'task-registration', 'runtime-resolution', 'artifact-collection']) {
        clear(); def original = phase == 'runtime-resolution' ? new IllegalStateException('PRIVATE_MESSAGE') : new PrivateNoticeFailure(); Throwable caught
        try { execute(main, main.path, true, [phase: phase, failure: original, diagnostics: true, runTask: true]) } catch (Throwable failure) { caught = failure }
        assert caught.is(original)
        def text = report.text, value = new JsonSlurper().parseText(text)
        assert value == [schema: 1, status: 'INCOMPLETE', complete: false, sourceCommit: 'a' * 40, platform: 'android', stage: 'setup', setup: [phase: 'gradle-resolution', errorCategory: 'command-failed', collector: [phase: phase, errorClass: phase == 'runtime-resolution' ? 'IllegalStateException' : 'Throwable']]]
        assert !text.contains('PRIVATE') && !text.contains(fixture.path) && !text.contains('stack')
    }
    for (blocked in ['file', 'symlink']) {
        clear(); if (blocked == 'file') build.text = 'PRIVATE_BLOCKER'; else Files.createSymbolicLink(build.toPath(), new File(fixture, 'outside').tap { mkdirs() }.toPath())
        def original = new IllegalArgumentException('PRIVATE_ORIGINAL'); Throwable caught
        try { execute(main, main.path, true, [phase: 'runtime-resolution', failure: original, diagnostics: true, runTask: true]) } catch (Throwable failure) { caught = failure }
        assert caught.is(original) && !report.exists()
        build.delete()
    }
    println 'Actual init source: 7 root guards +4 finite Throwable phases +2 failed/outside writers PASS; no Gradle build.'
} finally { fixture.deleteDir() }
