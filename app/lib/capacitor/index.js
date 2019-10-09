const fse = require('fs-extra')

const
  log = require('../helpers/logger')('app:capacitor'),
  warn = require('../helpers/logger')('app:capacitor', 'red'),
  CapacitorConfig = require('./capacitor-config'),
  { spawn, spawnSync } = require('../helpers/spawn'),
  onShutdown = require('../helpers/on-shutdown'),
  appPaths = require('../app-paths'),
  openIde = require('../helpers/open-ide')

const capacitorCliPath = require('./capacitor-cli-path')

class CapacitorRunner {
  constructor () {
    this.pid = 0
    this.config = new CapacitorConfig()

    onShutdown(() => {
      this.stop()
    })
  }

  async run (quasarConfig) {
    const
      cfg = quasarConfig.getBuildConfig(),
      url = cfg.build.APP_URL

    if (this.url === url) {
      return
    }

    if (this.pid) {
      this.stop()
    }

    this.url = url

    this.config.prepare(cfg)

    await this.__runCapacitorCommand(['sync', cfg.ctx.targetName])

    openIde('capacitor', cfg.ctx.targetName, true)
  }

  async build (quasarConfig, argv) {
    const cfg = quasarConfig.getBuildConfig()

    this.config.prepare(cfg)

    await this.__runCapacitorCommand(['sync', cfg.ctx.targetName])

    if (argv['skip-pkg'] === true) {
      return
    }

    if (argv.ide === true) {
      openIde('capacitor', cfg.ctx.targetName)
      process.exit(0)
    }

    if (cfg.ctx.targetName === 'ios') {
      await this.__buildIos(argv, cfg)
    }
    else {
      await this.__buildAndroid(argv, cfg)
    }
  }

  async __buildIos (argv, cfg) {
    const args = 'xcodebuild -workspace App.xcworkspace -scheme App -configuration release -derivedDataPath'

    log('Building iOS app...')

    await spawnSync(
      'xcrun',
      args.split(' ').concat([ cfg.build.packagedDistDir ]).concat(argv._),
      { cwd: appPaths.resolve.capacitor('ios/App') },
      () => {
        console.log()
        console.log(` ⚠️  xcodebuild command failed!`)
        console.log(` ⚠️  As an alternative, you can use the "--ide" param and build from the IDE.`)
        console.log()

        // cleanup build folder
        fse.removeSync(
          cfg.build.packagedDistDir
        )
      }
    )
  }

  async __buildAndroid (argv, cfg) {
    const buildPath = appPaths.resolve.capacitor(
      'android/app/build/outputs/apk/' + (cfg.ctx.debug ? 'debug' : 'release')
    )

    // Remove old build output
    fse.removeSync(buildPath)

    log('Building Android app...')

    await spawnSync(
      `./gradlew${process.platform === 'win32' ? '.bat' : ''}`,
      [ `assemble${cfg.ctx.debug ? 'Debug' : 'Release'}` ].concat(argv._),
      { cwd: appPaths.resolve.capacitor('android') },
      () => {
        console.log()
        console.log(` ⚠️  Gradle build failed!`)
        console.log(` ⚠️  As an alternative, you can use the "--ide" param and build from the IDE.`)
        console.log()
      }
    )

    fse.copySync(buildPath, cfg.build.packagedDistDir)
  }

  stop () {
    if (!this.pid) { return }

    log('Shutting down Capacitor process...')
    process.kill(this.pid)
    this.__cleanup()
  }

  __runCapacitorCommand (args) {
    return new Promise(resolve => {
      this.pid = spawn(
        capacitorCliPath,
        args,
        { cwd: appPaths.capacitorDir },
        code => {
          this.__cleanup()

          if (code) {
            warn(`⚠️  [FAIL] Capacitor CLI has failed`)
            process.exit(1)
          }

          resolve && resolve(code)
        }
      )
    })
  }

  __cleanup () {
    this.pid = 0
    this.config.reset()
  }
}

module.exports = new CapacitorRunner()