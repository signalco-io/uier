export { slackAdapter } from './adapter';
export { isSlackConfigured } from './config';
export { beginSlackConnect, finishSlackConnect, disconnectSlack, SlackConnectionError } from './connection';
export { getSlackSettings, loadSlackChannels, saveSlackDestination, setSlackEnabled, setSlackFiles,
    sendSlackTestNotification, resumeSlackNotification, resolveSlackUncertainPost, clearSlackRateReview, listSlackRateReviews } from './settings';
