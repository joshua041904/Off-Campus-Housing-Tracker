# Shared default list for build-housing-images-k3s.sh and rebuild-all-housing-images-k3s.sh.
# transport-watchdog: image only; rollouts map to deploy/api-gateway (see rebuild-och-images-and-rollout.sh).
HOUSING_DOCKER_SERVICES_DEFAULT="auth-service listings-service booking-service messaging-service trust-service analytics-service media-service notification-service api-gateway transport-watchdog"
