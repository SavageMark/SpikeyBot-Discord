// Copyright 2018 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
//
// This script is used to convert the hunger games events from the old
// single-JSON-file format to an ID based filesystem.
const fs = require('fs');
const mkdirp = require('mkdirp');
const sql = require('mysql');
const auth = require('./auth.js');

const oldFile = './save/hgEvents.json';
const idListFile = './save/hgDefaultEvents.json';
const newDir = './save/hg/events/';
const ownerId = '124733888177111041';

let old = JSON.parse(fs.readFileSync(oldFile));

mkdirp.sync(newDir);

/**
 * The object describing the connection with the SQL server.
 *
 * @private
 * @type {sql.ConnectionConfig}
 */
let sqlCon;
/**
 * Create initial connection with sql server.
 *
 * @private
 */
function connectSQL() {
  /* eslint-disable-next-line new-cap */
  sqlCon = new sql.createConnection({
    user: auth.sqlUsername,
    password: auth.sqlPassword,
    host: auth.sqlHost,
    database: 'appusers',
    port: 3306,
  });
  sqlCon.on('error', function(e) {
    throw e;
  });
}
connectSQL();

let oldEnt = Object.entries(old);

let newIds = {};
let randList = {};

let numDone = 0;
let numTotal = 0;
oldEnt.forEach((el) => {
  numTotal += el[1].length;
  let type = el[0] == 'arena' ? 'arena' : 'normal';
  newIds[el[0]] = [];

  mkdirp(newDir + ownerId, (err) => {
    if (err) {
      throw err;
    }
    el[1].forEach((evt) => {
      let rand;
      // This should all happen really quickly, just to be safe, ensure there
      // are no identical random numbers. Doesn't hurt to be extra careful here.
      do {
        rand = Math.floor((Math.random() * Math.pow(36, 6))).toString(36);
      } while (randList[rand]);
      randList[rand] = true;

      let now = Date.now();
      let id = `${ownerId}/${now}-${rand}`;
      newIds[el[0]].push(id);

      evt.id = id;
      evt.type = type;
      evt.creator = ownerId;
      evt.privacy = 'public';

      fs.writeFile(newDir + id + '.json', JSON.stringify(evt), (err) => {
        if (err) {
          throw err;
        }
        sqlCon.query(toSend, (err) => {
          if (err) {
            console.error('SQL QUERY FAILED:', toSend);
            throw err;
          }
          done();
        });
      });
      let toSend = sqlCon.format(
          'INSERT INTO HGEvents (Id, CreatorId, DateCreated, Privacy) ' +
              'VALUES (?, ?, FROM_UNIXTIME(?), "public")',
          [id, ownerId, now / 1000]);
    });
  });
});

/**
 * Callback for each completed event request.
 */
function done() {
  numDone++;
  if (numDone < numTotal) return;
  process.stdout.write('\n');
  fs.writeFile(idListFile, JSON.stringify(newIds, null, 2), (err) => {
    if (err) {
      throw err;
    } else {
      console.log('Default event IDs written to', idListFile);
      sqlCon.end((err) => {
        if (err) console.error(err);
        console.log('Done');
      });
    }
  });
}
