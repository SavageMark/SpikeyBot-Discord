// Copyright 2018 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const fs = require('fs');
const childProcess = require('child_process');
require('./mainModule.js')(SMLoader); // Extends the MainModule class.

/**
 * @classdesc Manages loading, unloading, and reloading of all SubModules.
 * @class
 * @augments MainModule
 */
function SMLoader() {
  const self = this;
  /** @inheritdoc */
  this.myName = 'SMLoader';

  /** @inheritdoc */
  this.import = function(data) {
    if (!data) return;
    subModules = data.subModules;
    subModuleNames = data.subModuleNames;
  };
  /** @inheritdoc */
  this.export = function() {
    return {
      subModules: subModules,
      subModuleNames: subModuleNames,
    };
  };
  /** @inheritdoc */
  this.terminate = function() {
    for (let i in subModules) {
      if (subModules[i] && subModules[i].end) {
        subModules[i].end();
      }
    }
  };
  /** @inheritdoc */
  this.initialize = function() {
    self.command.on('reload', commandReload);
    self.command.on('unload', commandUnload);
    self.command.on('load', commandLoad);
    self.command.on('help', commandHelp);

    Object.assign(self.bot, toAssign.bot);
    Object.assign(self.client, toAssign.client);

    fs.readFile(smListFilename, (err, data) => {
      if (err) {
        self.error(
            'Failed to read list of subModules from file: ' + smListFilename);
        console.error(err);
        return;
      }
      try {
        let parsed = JSON.parse(data);
        if (!parsed) {
          self.error('Empty list of subModules from file: ' + smListFilename);
          return;
        }
        goalSubModuleNames = parsed[self.bot.getFullBotName()];
        if (!goalSubModuleNames) {
          self.error(
              'Unable to find subModule list for bot: (' +
              self.bot.getFullBotName() + ') ' + smListFilename);
          return;
        }
        self.reload();
      } catch (e) {
        self.error(
            'Failed to parse subModule list from file: ' + smListFilename);
        console.error(e);
      }
    });
  };
  this.shutdown = function() {
    self.command.deleteEvent('reload');
    self.command.deleteEvent('unload');
    self.command.deleteEvent('load');
    self.command.deleteEvent('help');

    let data = fs.readFileSync(smListFilename);
    let parsed = JSON.parse(data);
    parsed[self.bot.getFullBotName()] = goalSubModuleNames;
    fs.writeFileSync(smListFilename, JSON.stringify(parsed, null, 2));
  };
  /** @inheritdoc */
  this.unloadable = function() {
    return subModuleNames.findIndex((el) => {
      return !subModules[el].unloadable();
    }) < 0;
  };
  /** @inheritdoc */
  this.save = function(...args) {
    for (let i in subModules) {
      if (subModules[i] && subModules[i].save) {
        subModules[i].save.apply(null, args);
      }
    }
  };

  /**
   * Properties to merge into other objects. `bot` is merged into self.bot,
   * `client` is merged into self.client.
   *
   * @private
   * @type {Class}
   */
  let toAssign = {bot: {}, client: {}};

  /**
   * The filename storing the list of all SubModules to load.
   *
   * @private
   * @constant
   * @defualt
   * @type {string}
   */
  const smListFilename = './subModules.json';

  /**
   * The list of all submodule names currently loaded.
   *
   * @private
   * @type {string[]}
   */
  let subModuleNames = [];
  /**
   * The list of all submodules that we are intended to have loaded currently.
   * This should reflect the file at {@link SMloader~smListFilename}. Null means
   * the data is not available, and no action should be taken.
   *
   * @private
   * @type {null|string[]}
   */
  let goalSubModuleNames = null;
  /**
   * Instances of SubModules currently loaded mapped by their name.
   *
   * @private
   * @type {Object.<SubModule>}
   */
  let subModules = {};

  /**
   * Timeouts for retrying to unload submodules that are currently not in an
   * unloadable state. Mapped by name of submodule.
   *
   * @private
   * @type {Object.<Timeout>}
   */
  let unloadTimeouts = {};

  /**
   * Callbacks for when a scheduled module to unload, has been unloaded. Mapped
   * by name of subModule, then array of all callbacks.
   *
   * @private
   * @type {Object.<Array.<Function>>}
   */
  let unloadCallbacks = {};

  /**
   * Discord IDs that are allowed to reboot the bot.
   *
   * @private
   * @type {string[]}
   * @constant
   */
  const trustedIds = [
    '124733888177111041',  // Me
    '126464376059330562',  // Rohan
  ];

  /**
   * The message sent to the channel where the user asked for help.
   *
   * @private
   * @type {string}
   * @constant
   */
  const helpmessagereply = 'I sent you a DM with commands!';
  /**
   * The message sent to the channel where the user asked to be DM'd, but we
   * were unable to deliver the DM.
   *
   * @private
   * @type {string}
   * @constant
   */
  const blockedmessage =
      'I couldn\'t send you a message, you probably blocked me :(';

  /**
   * Get array of all submodule names and the commit they were last loaded from.
   *
   * @public
   * @return {Array.<{name: string, commit: string}>}
   */
  toAssign.bot.getSubmoduleCommits = function() {
    return subModuleNames.map((el) => {
      return {name: el, commit: subModules[el].commit || 'Unknown'};
    });
  };

  /**
   * Get a reference to a submodule with the given name.
   *
   * @public
   * @param {string} name The name of the submodule.
   * @return {?SubModule}
   */
  toAssign.bot.getSubmodule = function(name) {
    return subModules[name];
  };

  /**
   * Unloads submodules that is currently loaded.
   * @public
   *
   * @param {string} name Specify submodule to unload. If it is already
   * unloaded, it will be ignored and return successful.
   * @param {Object} [opts] Options object.
   * @param {boolean} [opts.schedule=true] Automatically re-schedule unload for
   * submodule if it is in an unloadable state.
   * @param {boolean} [opts.ignoreUnloadable=false] Force a submodule to unload
   * even if it is not in an unloadable state.
   * @param {boolean} [opts.updateGoal=true] Update the goal state of the
   * subModule to unloaded.
   * @param {Function} [cb] Callback to fire once the operation is complete.
   * Single parameter is null if success, or string if error.
   */
  this.unload = function(name, opts, cb) {
    if (!opts) {
      opts = {schedule: true, updateGoal: true, ignoreUnloadable: false};
    } else {
      if (opts.schedule == null) opts.schedule = true;
      if (opts.updateGoal == null) opts.updateGoal = true;
    }
    let sm = subModules[name];
    if (!sm) {
      let nameIndex = subModuleNames.findIndex((el) => el == name);
      if (nameIndex >= 0) {
        self.error(
            'Unloaded module still exists in list of names!' +
            ' This should not happen!');
        subModuleNames.splice(nameIndex, 1);
      }
      cb(null);
      return;
    }
    if (!opts.ignoreUnloadable) {
      if (!sm.unloadable()) {
        if (opts.schedule) {
          if (unloadTimeouts[name]) {
            if (!unloadCallbacks[name]) unloadCallbacks[name] = [];
            unloadCallbacks[name].push(cb);
          } else {
            unloadTimeouts[name] = setTimeout(function() {
              delete unloadTimeouts[name];
              self.unload(name, opts, cb);
            }, 10000);
          }
        } else {
          cb('Not Unloadable');
        }
        return;
      }
    }
    try {
      if (subModules[name].save) {
        subModules[name].save();
      } else {
        self.error('Submodule ' + name + ' does not have a save() function.');
      }
      if (subModules[name].end) {
        subModules[name].end();
      } else {
        self.error('Submodule ' + name + ' does not have an end() function.');
      }
    } catch (err) {
      self.error('Error on unloading ' + name);
      console.log(err);
    }
    let message;
    try {
      delete require.cache[require.resolve(name)];
      subModuleNames.splice(subModuleNames.findIndex((el) => el == name), 1);
      if (opts.updateGoal) {
        goalSubModuleNames.splice(
            goalSubModuleNames.findIndex((el) => el == name), 1);
      }
      message = null;
    } catch (err) {
      self.error('Failed to clearing: ' + name);
      console.log(err);
      message = 'Failed to Unload';
    }
    cb(message);
    if (unloadCallbacks[name]) {
      unloadCallbacks[name].splice(0).forEach((el) => {
        el(message);
      });
    }
  };
  /**
   * Loads submodules from file.
   * @public
   *
   * @param {string} name Specify submodule to load. If it is already loaded,
   * they will be ignored and return successful.
   * @param {Object} [opts] Options object.
   * @param {boolean} [opts.updateGoal=true] Update the goal state of the
   * subModule to loaded.
   * @param {Function} [cb] Callback to fire once the operation is complete.
   * Single parameter is null if success, or string if error.
   */
  this.load = function(name, opts, cb) {
    if (!opts) {
      opts = {updateGoal: true};
    } else {
      if (opts.updateGoal == null) opts.updateGoal = true;
    }
    if (subModules[name]) {
      if (opts.updateGoal && !goalSubModuleNames.includes(name)) {
        goalSubModuleNames.push(name);
      }
    }
    try {
      subModules[name] = require(name);
      subModules[name].modifiedTime = fs.statSync(__dirname + '/' + name).mtime;
      if (subModuleNames.includes(name)) {
        self.error(
            'Submodule that is not loaded already exists in list of ' +
            'loaded names! This should not happen!');
      } else {
        subModuleNames.push(name);
      }
      if (opts.updateGoal && !goalSubModuleNames.includes(name)) {
        goalSubModuleNames.push(name);
      }
    } catch (err) {
      cb('Failed to Load');
      self.error('Failed to load submodule: ' + name);
      console.error(err);
      return;
    }
    try {
      subModules[name].begin(
          self.Discord, self.client, self.command, self.common, self.bot);
    } catch (err) {
      self.error('Failed to initialize submodule: ' + name);
      console.error(err);
      cb('Failed to Initialize');
      return;
    }
    cb(null);
  };
  /**
   * Reloads submodules from file. Reloads currently loaded modules if
   * `name` is not specified. If a submodule is specified that is not
   * loaded, it will skip the unload step, bull will still be attempted to be
   * loaded.
   * @public
   *
   * @param {?string|string[]} [name] Specify submodules to reload, or null to
   * reload all submodules to their goal state.
   * @param {Object} [opts] Options object.
   * @param {boolean} [opts.schedule=true] Automatically re-schedule reload for
   * submodules if they are not in an unloadable state.
   * @param {boolean} [opts.ignoreUnloadable=false] Force a submodule to unload
   * even if it is not in an unloadable state.
   * @param {boolean} [opts.force=false] Reload a submodule even if the
   * currently loaded version is identical to the version on file. If false it
   * will not be reloaded if the version would not be changed due to a reload.
   * @param {Function} [cb] Callback to fire once the operation is complete.
   * Single parameter has array of strings of status of each module attempted to
   * be reloaded.
   */
  this.reload = function(name, opts, cb) {
    if (typeof cb !== 'function') cb = function() {};
    if (typeof name === 'string') name = [name];
    if (!name || name.length === 0) name = goalSubModuleNames;
    if (!Array.isArray(name) || name.length === 0) {
      cb([]);
      return;
    }
    if (!opts) {
      opts = {schedule: true, force: false, ignoreUnloadable: false};
    } else if (opts.schedule == null) {
      opts.schedule = true;
    }
    opts.updateGoal = false;

    const numTotal = name.length;
    let numComplete = 0;
    let output = [];
    for (let i = 0; i < numTotal; i++) {
      if (!opts.force && subModules[name[i]]) {
        try {
          let mtime = fs.statSync(__dirname + '/' + name[i]).mtime;
          // For some reason, directly comparing these two for equality does not
          // work.
          if (mtime - subModules[name[i]].modifiedTime == 0) {
            output.push(name[i] + ': Unchanged');
            done();
            continue;
          }
        } catch (err) {
          self.error(
              'Failed to stat submodule: ' + __dirname + '/' + name[i]);
          console.error(err);
          output.push('(' + name[i] + ': failed to stat)');
        }
      }
      reloadSingle(name[i]);
    }
    /**
     * Actually trigger the reload process for a single submodule.
     * @private
     *
     * @param {string} name The submodule name to reload.
     */
    function reloadSingle(name) {
      self.unload(name, opts, (err) => {
        if (err) {
          output.push(name + ': ' + err);
          done();
          return;
        }
        self.load(name, opts, (err2) => {
          if (err2) {
            output.push(name + ': ' + err2);
            done();
            return;
          }
          output.push(name + ': `Success`');
          done();
        });
      });
    }
    /**
     * Called when a submodule's reload process is completed. Fires main
     * callback once all submodules reloads have been completed.
     * @private
     */
    function done() {
      numComplete++;
      if (numComplete != numTotal) return;
      cb(output);
    }
  };

  /**
   * Reload all sub modules by unloading then re-requiring.
   *
   * @private
   * @type {Command~commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#reload
   */
  function commandReload(msg) {
    if (trustedIds.includes(msg.author.id)) {
      let toReload = msg.text.split(' ').splice(1);
      let opts = {};
      toReload = toReload.filter((el) => {
        switch (el) {
          case '--force':
            opts.force = true;
            return false;
          case '--no-schedule':
            opts.ignoreUnloadable = true;
            return false;
          case '--immediate':
            opts.schedule = false;
            return false;
          default:
            return true;
        }
      });
      self.common.reply(msg, 'Reloading modules...').then((warnMessage) => {
        self.reload(toReload, opts, (out) => {
          let embed = new self.Discord.MessageEmbed();
          embed.setTitle('Reload complete.');
          embed.setColor([255, 0, 255]);
          embed.setDescription(out.join('\n') || 'NOTHING reloaded');
          warnMessage.edit(self.common.mention(msg), embed);
        });
      });
    } else {
      self.common.reply(
          msg, 'LOL! Good try!',
          'It appears SpikeyRobot doesn\'t trust you enough with this ' +
              'command. Sorry!');
    }
  }

  /**
   * Unload specific sub modules.
   *
   * @private
   * @type {Command~commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#unload
   */
  function commandUnload(msg) {
    if (trustedIds.includes(msg.author.id)) {
      let toUnload = msg.text.split(' ').splice(1);
      let opts = {};
      toReload = toUnload.filter((el) => {
        switch (el) {
          case 'force':
            opts.force = true;
            return false;
          case 'no-schedule':
            opts.ignoreUnloadable = true;
            return false;
          case 'immediate':
            opts.schedule = false;
            return false;
          default:
            return true;
        }
      });
      self.common.reply(msg, 'Unloading modules...').then((warnMessage) => {
        const numTotal = toUnload.length;
        let numComplete = 0;
        let outs = [];
        for (let i = 0; i < numTotal; i++) {
          unloadSingle(toUnload[i]);
        }
        /**
         * Begins actually loading a module.
         * @private
         *
         * @param {string} name The name of the module.
         */
        function unloadSingle(name) {
          self.unload(name, opts, (out) => {
            outs.push(name + ': ' + (out || 'Success'));
            done();
          });
        }
        /**
         * Triggered on each completed action.
         * @private
         */
        function done() {
          numComplete++;
          if (numComplete < numTotal) return;
          let embed = new self.Discord.MessageEmbed();
          embed.setTitle('Unload complete.');
          embed.setColor([255, 0, 255]);
          embed.setDescription(out.join(' ') || 'NOTHING unloaded');
          warnMessage.edit(self.common.mention(msg), embed);
        }
        if (numTotal == 0) done();
      });
    } else {
      self.common.reply(
          msg, 'LOL! Good try!',
          'It appears SpikeyRobot doesn\'t trust you enough with this ' +
              'command. Sorry!');
    }
  }

  /**
   * Load specific sub modules.
   *
   * @private
   * @type {Command~commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#load
   */
  function commandLoad(msg) {
    if (trustedIds.includes(msg.author.id)) {
      let toUnload = msg.text.split(' ').splice(1);
      self.common.reply(msg, 'Loading modules...').then((warnMessage) => {
        const numTotal = toUnload.length;
        let numComplete = 0;
        let outs = [];
        for (let i = 0; i < numTotal; i++) {
          loadSingle(toUnload[i]);
        }
        /**
         * Begins actually loading a module.
         * @private
         * @param {string} name The name of the subModule.
         */
        function loadSingle(name) {
          self.unload(name, null, (out) => {
            outs.push(name + ': ' + (out || 'Success'));
            done();
          });
        }
        /**
         * Triggered on each completed action.
         * @private
         */
        function done() {
          numComplete++;
          if (numComplete < numTotal) return;
          let embed = new self.Discord.MessageEmbed();
          embed.setTitle('Load complete.');
          embed.setColor([255, 0, 255]);
          embed.setDescription(out.join(' ') || 'NOTHING loaded');
          warnMessage.edit(self.common.mention(msg), embed);
        }
        if (numTotal == 0) done();
      });
    } else {
      self.common.reply(
          msg, 'LOL! Good try!',
          'It appears SpikeyRobot doesn\'t trust you enough with this ' +
              'command. Sorry!');
    }
  }

  /**
   * Send help message to user who requested it.
   *
   * @private
   * @type {Command~commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#help
   */
  function commandHelp(msg) {
    try {
      let error = false;
      for (let i in subModules) {
        if (subModules[i] instanceof Object && subModules[i].helpMessage) {
          msg.author.send(subModules[i].helpMessage).catch((err) => {
            if (msg.guild !== null && !error) {
              error = true;
              self.common
                  .reply(
                      msg, 'Oops! I wasn\'t able to send you the help!\n' +
                          'Did you block me?',
                      err.message)
                  .catch(() => {});
              self.error(
                  'Failed to send help message in DM to user: ' +
                  msg.author.id);
              console.error(err);
            }
          });
        }
      }
      if (msg.guild !== null) {
        self.common
            .reply(
                msg, helpmessagereply,
                'Tip: https://www.spikeybot.com also has more information.')
            .catch((err) => {
              self.error(
                  'Unable to reply to help command in channel: ' +
                  msg.channel.id);
              console.log(err);
            });
      }
    } catch (err) {
      self.common.reply(msg, blockedmessage);
      self.error('An error occured while sending help message!');
      console.error(err);
    }
  }


  /**
   * Check current loaded submodule commit to last modified commit, and reload
   * if the file has changed.
   *
   * @public
   */
  toAssign.client.reloadUpdatedSubModules = function() {
    try {
      self.log('Reloading updated submodules.');
      for (let i = 0; i < subModuleNames.length; i++) {
        childProcess
            .exec(
                'git diff-index --quiet ' +
                subModules[subModuleNames[i]].commit + ' -- ./src/' +
                subModuleNames[i])
            .on('close', ((name) => {
              return (code, signal) => {
                if (code) {
                  self.reload(name, {force: true}, (out) => {
                    self.log(out.join(' '));
                  });
                } else {
                  self.debug(name + ' unchanged (' + code + ')');
                }
              };
            })(subModuleNames[i]));
      }
    } catch (err) {
      self.error('Failed to reload updated submodules!');
      console.error(err);
    }
  };
}
module.exports = new SMLoader();
