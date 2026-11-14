// Pure Groovy execution of the actual init script with Gradle callbacks stubbed.
// Uses the Groovy/Gradle API jars already included in a Gradle distribution;
// starts no Gradle build, dependency resolution, daemon or Android tooling.
import org.gradle.api.GradleException
import org.codehaus.groovy.control.CompilerConfiguration
import org.codehaus.groovy.control.customizers.ImportCustomizer
import java.nio.file.Files

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
    def execute = { File actual, Object requested, boolean hasApp ->
        def registered = []; int lookups = 0
        def app = [tasks: [register: { name, body -> registered.add(name) }]]
        def target = [projectDir: actual, findProject: { path -> assert path == ':app'; lookups++; hasApp ? app : null }]
        def properties = requested == null ? [:] : [noticeMainProjectRoot: requested]
        // Included builds need not repeat the main invocation's CLI properties.
        def parent = actual == included ? [startParameter: [projectProperties: properties]] : null
        def invocation = [parent: parent, rootProject: target, startParameter: [projectProperties: parent == null ? properties : [:]], projectsEvaluated: { body -> body.call() }]
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
    println 'Actual Gradle init script: included build skipped; main/canonical alias registered; missing app/root rejected (7 cases).'
} finally { fixture.deleteDir() }
