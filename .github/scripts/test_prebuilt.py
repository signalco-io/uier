import io
import pathlib
import tarfile
import tempfile
import textwrap
import unittest


workflow = pathlib.Path(__file__).resolve().parents[1] / 'workflows/vercel-deploy_reusable.yml'
source = workflow.read_text().split("          python3 - prebuilt.tar.gz <<'PYTHON'\n", 1)[1].split('          PYTHON\n', 1)[0]
namespace = {'__name__': 'prebuilt_extractor_test'}
exec(compile(textwrap.dedent(source), str(workflow), 'exec'), namespace)


class BuildArchiveTests(unittest.TestCase):
    def archive(self, directory, names):
        path = pathlib.Path(directory) / 'prebuilt.tar.gz'
        with tarfile.open(path, 'w:gz') as output:
            for name, link in names:
                info = tarfile.TarInfo(name)
                if link:
                    info.type = tarfile.SYMTYPE
                    info.linkname = link
                    output.addfile(info)
                else:
                    content = b'{"version":3}'
                    info.size = len(content)
                    output.addfile(info, io.BytesIO(content))
        return path

    def test_only_build_output_is_extracted(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = self.archive(directory, [('.vercel/output/config.json', None),
                ('.vercel/output/static/config-link', '../config.json')])
            target = pathlib.Path(directory) / 'unpacked'
            namespace['extract'](archive, target)
            self.assertEqual((target / '.vercel/output/static/config-link').read_text(), '{"version":3}')

    def test_paths_credentials_and_links_cannot_escape_the_output(self):
        for name, link in [('package.json', None), ('.vercel/project.json', None),
            ('.vercel/output/../../bin/vercel', None), ('/tmp/arbitrary', None),
            ('.vercel/output/.env.production.local', None), ('.vercel/output/static/.env', None),
            ('.vercel/output/static/link', '../../../../package.json'), ('.vercel/output/link', '/tmp')]:
            with self.subTest(name=name, link=link), tempfile.TemporaryDirectory() as directory:
                archive = self.archive(directory, [(name, link)])
                with self.assertRaises(ValueError):
                    namespace['extract'](archive, pathlib.Path(directory) / 'unpacked')


if __name__ == '__main__':
    unittest.main()
