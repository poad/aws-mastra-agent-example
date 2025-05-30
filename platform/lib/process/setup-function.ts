import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const compileCloudFrontBundles = () => {
  ['function'].forEach((f) => {
    fs.readdirSync(`${process.cwd()}/${f}`, {
      withFileTypes: true,
    })
      .filter(
        (p) =>
          p.isFile() && (p.name.endsWith('.js') || p.name.endsWith('.d.ts')),
      )
      .map((p) => `${process.cwd()}/${f}/${p.name}`)
      .forEach((file) => {
        if (fs.existsSync(file)) {
          fs.rmSync(file, {
            recursive: true,
          });
        }
      });
    ['pnpm install'].forEach((cmd) => {
      childProcess.execSync(cmd, {
        cwd: `${process.cwd()}/${f}/`,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env },
        shell: process.env.SHELL || 'bash',
      });
    });
  });

  ['function'].forEach((f) => {
    childProcess.execSync('pnpm build', {
      cwd: path.resolve(`${process.cwd()}/${f}/`),
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env },
      shell: process.env.SHELL || 'bash',
    });
  });
};
