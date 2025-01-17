'use strict';

const { connect, createLocalVideoTrack, Logger } = require('twilio-video');
const { isMobile } = require('./browser');

const $leave = $('#leave-room');
const $startScreen = $('#start-sharing');
const $room = $('#room');
const $activeParticipant = $('div#active-participant > div.participant.main', $room);
const $activeVideo = $('video', $activeParticipant);
const $participants = $('div#participants', $room);

// The current active Participant in the Room.
let activeParticipant = null;

// Whether the user has selected the active Participant by clicking on
// one of the video thumbnails.
let isActiveParticipantPinned = false;

/**
 * Updates the Network Quality report for a Participant.
 */
function updateNetworkQualityReport(participant) {
  console.log("RECEIVED updateNetworkQualityReport", participant);
  const participantDiv = document.getElementById(participant.sid);
  $(participantDiv).attr("data-identity", `NQ Level (${participant.identity}): ${participant.networkQualityLevel}`);
  /*
    const title = participantDiv.querySelector('h6');
    title.innerHTML = `NQ Level (${participant.identity}): ${participant.networkQualityLevel}`;
    const stats = participantDiv.querySelector('textarea');
    stats.value = `NQ Stats:\r\n========\r\n${JSON.stringify(participant.networkQualityStats, null, 2)}`;
    */
}

var Video = require('twilio-video');

/**
 * Connect to a Room with the Network Quality API enabled.
 * This API is available only in Small Group or Group Rooms.
 * @param {string} token - Token for joining the Room
 * @param {number} localVerbosity - Verbosity level of Network Quality reports
 *   for the LocalParticipant [1 - 3]
 * @param {number} remoteVerbosity - Verbosity level of Network Quality reports
 *   for the RemoteParticipant(s) [0 - 3]
 * @returns {CancelablePromise<Room>}
 */
function connectToRoomWithNetworkQuality(token, localVerbosity, remoteVerbosity) {
  return Video.connect(token, {
    networkQuality: {
      local: localVerbosity,
      remote: remoteVerbosity
    }
  });
}

/**
 * Listen to changes in the Network Quality report of a Participant and update
 * your application.
 * @param {Participant} participant - The Participant whose updates you want to listen to
 * @param {function} updateNetworkQualityReport - Updates the app UI with the new
 *   Network Quality report of the Participant.
 * @returns {void}
 */
function setupNetworkQualityUpdatesForParticipant(participant, updateNetworkQualityReport) {
  updateNetworkQualityReport(participant);
  participant.on('networkQualityLevelChanged', function () {
    updateNetworkQualityReport(participant);
  });
}

/**
 * Listen to changes in the Network Quality reports and update your application.
 * @param {Room} room - The Room you just joined
 * @param {function} updateNetworkQualityReport - Updates the app UI with the new
 *   Network Quality report of a Participant.
 * @returns {void}
 */
function setupNetworkQualityUpdates(room, updateNetworkQualityReport) {
  // Listen to changes in Network Quality level of the LocalParticipant.
  setupNetworkQualityUpdatesForParticipant(room.localParticipant, updateNetworkQualityReport);
  // Listen to changes in Network Quality levels of RemoteParticipants already
  // in the Room.
  room.participants.forEach(function (participant) {
    setupNetworkQualityUpdatesForParticipant(participant, updateNetworkQualityReport);
  });
  // Listen to changes in Network Quality levels of RemoteParticipants that will
  // join the Room in the future.
  room.on('participantConnected', function (participant) {
    setupNetworkQualityUpdatesForParticipant(participant, updateNetworkQualityReport);
  });
}

/**
 * Change the local and remote Network Quality verbosity levels after joining the Room.
 * @param {Room} room - The Room you just joined
 * @param {number} localVerbosity - Verbosity level of Network Quality reports
 *   for the LocalParticipant [1 - 3]
 * @param {number} remoteVerbosity - Verbosity level of Network Quality reports
 *   for the RemoteParticipant(s) [0 - 3]
 * @returns {void}
 */
function setNetworkQualityConfiguration(room, localVerbosity, remoteVerbosity) {
  room.localParticipant.setNetworkQualityConfiguration({
    local: localVerbosity,
    remote: remoteVerbosity
  });
}

/**
 * Set the active Participant's video.
 * @param participant - the active Participant
 */
function setActiveParticipant(participant) {
  if (activeParticipant) {
    const $activeParticipant = $(`div#${activeParticipant.sid}`, $participants);
    $activeParticipant.removeClass('active');
    $activeParticipant.removeClass('pinned');

    // Detach any existing VideoTrack of the active Participant.
    const { track: activeTrack } = Array.from(activeParticipant.videoTracks.values())[0] || {};
    if (activeTrack) {
      activeTrack.detach($activeVideo.get(0));
      $activeVideo.css('opacity', '0');
    }
  }

  // Set the new active Participant.
  activeParticipant = participant;
  const { identity, sid } = participant;
  const $participant = $(`div#${sid}`, $participants);

  $participant.addClass('active');
  if (isActiveParticipantPinned) {
    $participant.addClass('pinned');
  }

  // Attach the new active Participant's video.
  const { track } = Array.from(participant.videoTracks.values())[0] || {};
  if (track) {
    track.attach($activeVideo.get(0));
    $activeVideo.css('opacity', '');
  }

  // Set the new active Participant's identity
  $activeParticipant.attr('data-identity', identity);
}

/**
 * Set the current active Participant in the Room.
 * @param room - the Room which contains the current active Participant
 */
function setCurrentActiveParticipant(room) {
  const { dominantSpeaker, localParticipant } = room;
  setActiveParticipant(dominantSpeaker || localParticipant);
}

/**
 * Set up the Participant's media container.
 * @param participant - the Participant whose media container is to be set up
 * @param room - the Room that the Participant joined
 */
function setupParticipantContainer(participant, room) {
  const { identity, sid } = participant;

  // Add a container for the Participant's media.
  const $container = $(`<div class="participant" data-identity="${identity}" id="${sid}">
    <audio autoplay ${participant === room.localParticipant ? 'muted' : ''} style="opacity: 0"></audio>
    <video autoplay muted playsinline style="opacity: 0"></video>
  </div>`);

  // Toggle the pinning of the active Participant's video.
  $container.on('click', () => {
    if (activeParticipant === participant && isActiveParticipantPinned) {
      // Unpin the RemoteParticipant and update the current active Participant.
      setVideoPriority(participant, null);
      isActiveParticipantPinned = false;
      setCurrentActiveParticipant(room);
    } else {
      // Pin the RemoteParticipant as the active Participant.
      if (isActiveParticipantPinned) {
        setVideoPriority(activeParticipant, null);
      }
      setVideoPriority(participant, 'high');
      isActiveParticipantPinned = true;
      setActiveParticipant(participant);
    }
  });

  // Add the Participant's container to the DOM.
  $participants.append($container);
}

/**
 * Set the VideoTrack priority for the given RemoteParticipant. This has no
 * effect in Peer-to-Peer Rooms.
 * @param participant - the RemoteParticipant whose VideoTrack priority is to be set
 * @param priority - null | 'low' | 'standard' | 'high'
 */
function setVideoPriority(participant, priority) {
  participant.videoTracks.forEach(publication => {
    const track = publication.track;
    if (track && track.setPriority) {
      track.setPriority(priority);
    }
  });
}

/**
 * Attach a Track to the DOM.
 * @param track - the Track to attach
 * @param participant - the Participant which published the Track
 */
function attachTrack(track, participant) {
  // Attach the Participant's Track to the thumbnail.
  const $media = $(`div#${participant.sid} > ${track.kind}`, $participants);
  $media.css('opacity', '');
  track.attach($media.get(0));

  // If the attached Track is a VideoTrack that is published by the active
  // Participant, then attach it to the main video as well.
  if (track.kind === 'video' && participant === activeParticipant) {
    track.attach($activeVideo.get(0));
    $activeVideo.css('opacity', '');
  }
}

/**
 * Detach a Track from the DOM.
 * @param track - the Track to be detached
 * @param participant - the Participant that is publishing the Track
 */
function detachTrack(track, participant) {
  // Detach the Participant's Track from the thumbnail.
  const $media = $(`div#${participant.sid} > ${track.kind}`, $participants);
  const mediaEl = $media.get(0);
  $media.css('opacity', '0');
  track.detach(mediaEl);
  mediaEl.srcObject = null;

  // If the detached Track is a VideoTrack that is published by the active
  // Participant, then detach it from the main video as well.
  if (track.kind === 'video' && participant === activeParticipant) {
    const activeVideoEl = $activeVideo.get(0);
    track.detach(activeVideoEl);
    activeVideoEl.srcObject = null;
    $activeVideo.css('opacity', '0');
  }
}

/**
 * Handle the Participant's media.
 * @param participant - the Participant
 * @param room - the Room that the Participant joined
 */
function participantConnected(participant, room) {
  // Set up the Participant's media container.
  setupParticipantContainer(participant, room);

  // Handle the TrackPublications already published by the Participant.
  participant.tracks.forEach(publication => {
    trackPublished(publication, participant);
  });

  // Handle theTrackPublications that will be published by the Participant later.
  participant.on('trackPublished', publication => {
    trackPublished(publication, participant);
  });
}

/**
 * Handle a disconnected Participant.
 * @param participant - the disconnected Participant
 * @param room - the Room that the Participant disconnected from
 */
function participantDisconnected(participant, room) {
  // If the disconnected Participant was pinned as the active Participant, then
  // unpin it so that the active Participant can be updated.
  if (activeParticipant === participant && isActiveParticipantPinned) {
    isActiveParticipantPinned = false;
    setCurrentActiveParticipant(room);
  }

  // Remove the Participant's media container.
  $(`div#${participant.sid}`, $participants).remove();
}

/**
 * Handle to the TrackPublication's media.
 * @param publication - the TrackPublication
 * @param participant - the publishing Participant
 */
function trackPublished(publication, participant) {
  // If the TrackPublication is already subscribed to, then attach the Track to the DOM.
  if (publication.track) {
    attachTrack(publication.track, participant);
  }

  // Once the TrackPublication is subscribed to, attach the Track to the DOM.
  publication.on('subscribed', track => {
    attachTrack(track, participant);
  });

  // Once the TrackPublication is unsubscribed from, detach the Track from the DOM.
  publication.on('unsubscribed', track => {
    detachTrack(track, participant);
  });
}

/**
 * Join a Room.
 * @param token - the AccessToken used to join a Room
 * @param connectOptions - the ConnectOptions used to join a Room
 */
async function joinRoom(token, connectOptions) {
  // Comment the next two lines to disable verbose logging.
  const logger = Logger.getLogger('twilio-video');
  logger.setLevel('debug');

  // Join to the Room with the given AccessToken and ConnectOptions.
  connectOptions.networkQuality = {
    local: 3,
    remote: 3
  };
  const room = await connect(token, connectOptions);

  // Save the LocalVideoTrack.
  let localVideoTrack = Array.from(room.localParticipant.videoTracks.values())[0].track;

  // Make the Room available in the JavaScript console for debugging.
  window.room = room;

  // Handle the LocalParticipant's media.
  participantConnected(room.localParticipant, room);

  // Subscribe to the media published by RemoteParticipants already in the Room.
  room.participants.forEach(participant => {
    participantConnected(participant, room);
  });

  // Subscribe to the media published by RemoteParticipants joining the Room later.
  room.on('participantConnected', participant => {
    participantConnected(participant, room);
  });

  // Handle a disconnected RemoteParticipant.
  room.on('participantDisconnected', participant => {
    participantDisconnected(participant, room);
  });

  // Set the current active Participant.
  setCurrentActiveParticipant(room);

  // Update the active Participant when changed, only if the user has not
  // pinned any particular Participant as the active Participant.
  room.on('dominantSpeakerChanged', () => {
    if (!isActiveParticipantPinned) {
      setCurrentActiveParticipant(room);
    }
  });

  setupNetworkQualityUpdates(room, updateNetworkQualityReport);

  // Leave the Room when the "Leave Room" button is clicked.
  $leave.click(function onLeave() {
    $leave.off('click', onLeave);
    room.disconnect();
  });

  // Leave the Room when the "Leave Room" button is clicked.
  $startScreen.click(function onStartScreen() {
    const Video = require('twilio-video');
    function createScreenTrack(height, width) {
      if (typeof navigator === 'undefined'
        || !navigator.mediaDevices
        || !navigator.mediaDevices.getDisplayMedia) {
        return Promise.reject(new Error('getDisplayMedia is not supported'));
      }
      return navigator.mediaDevices.getDisplayMedia({
        video: {
          height: height,
          width: width
        }
      }).then(function (stream) {
        return new Video.LocalVideoTrack(stream.getVideoTracks()[0]);
      });
    }
    createScreenTrack(1366, 768).then((screen) => room.localParticipant.publishTrack(screen));
  });

  return new Promise((resolve, reject) => {
    // Leave the Room when the "beforeunload" event is fired.
    window.onbeforeunload = () => {
      room.disconnect();
    };

    if (isMobile) {
      // TODO(mmalavalli): investigate why "pagehide" is not working in iOS Safari.
      // In iOS Safari, "beforeunload" is not fired, so use "pagehide" instead.
      window.onpagehide = () => {
        room.disconnect();
      };

      // On mobile browsers, use "visibilitychange" event to determine when
      // the app is backgrounded or foregrounded.
      document.onvisibilitychange = async () => {
        if (document.visibilityState === 'hidden') {
          // When the app is backgrounded, your app can no longer capture
          // video frames. So, stop and unpublish the LocalVideoTrack.
          localVideoTrack.stop();
          room.localParticipant.unpublishTrack(localVideoTrack);
        } else {
          // When the app is foregrounded, your app can now continue to
          // capture video frames. So, publish a new LocalVideoTrack.
          localVideoTrack = await createLocalVideoTrack(connectOptions.video);
          await room.localParticipant.publishTrack(localVideoTrack);
        }
      };
    }

    room.once('disconnected', (room, error) => {
      // Clear the event handlers on document and window..
      window.onbeforeunload = null;
      if (isMobile) {
        window.onpagehide = null;
        document.onvisibilitychange = null;
      }

      // Stop the LocalVideoTrack.
      localVideoTrack.stop();

      // Handle the disconnected LocalParticipant.
      participantDisconnected(room.localParticipant, room);

      // Handle the disconnected RemoteParticipants.
      room.participants.forEach(participant => {
        participantDisconnected(participant, room);
      });

      // Clear the active Participant's video.
      $activeVideo.get(0).srcObject = null;

      // Clear the Room reference used for debugging from the JavaScript console.
      window.room = null;

      if (error) {
        // Reject the Promise with the TwilioError so that the Room selection
        // modal (plus the TwilioError message) can be displayed.
        reject(error);
      } else {
        // Resolve the Promise so that the Room selection modal can be
        // displayed.
        resolve();
      }
    });
  });
}

module.exports = joinRoom;
