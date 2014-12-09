/**
 * Seashell's frontend.
 * Copyright (C) 2013-2014 The Seashell Maintainers.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * See also 'ADDITIONAL TERMS' at the end of the included LICENSE file.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with self program.  If not, see <http://www.gnu.org/licenses/>.
 */
angular.module('frontend-app', ['seashell-websocket', 'seashell-projects', 'jquery-cookie', 'ui.router',
    'ui.bootstrap'])
  // Error service.
  .service('error-service', function () {
    var self = this;
    self.errors = [];

    self.report = function (error, shorthand) {
      if (error) {
        self.errors.push({shorthand: shorthand, error: error});
      }
    };
    self.suppress = function (index) {
      self.errors.splice(index, 1);
    };
  })
  // Confirmation message modal service.
  .factory('ConfirmationMessageModal', ['$modal',
      function ($modal) {
        return function (title, message) {
          return $modal.open({
            templateUrl: "frontend/templates/confirmation-template.html",
            controller: ['$scope', function ($scope) {
              $scope.title = title;
              $scope.message = message;
            }]});
        };
      }])
  // Delete Project Modal Service
  .factory('DeleteProjectModal', ['$modal', 'projects', 'error-service',
      function ($modal, projects, errors) {
        return function (project) {
          return $modal.open({
            templateUrl: "frontend/templates/delete-project-template.html",
            controller: ['$scope', function ($scope) {
              $scope.project = project;
            }]
          }).result.then(function () {
            return projects.delete(project).catch(
                function (error) {
                  errors.report(error, sprintf("Could not delete project %s!", project));
                });
          });
        };
      }])
  // New Project Modal Service
  .factory('NewProjectModal', ['$modal', 'projects', 'error-service',
      function ($modal, projects, errors) {
        return function () {
          return $modal.open({
            templateUrl: "frontend/templates/new-project-template.html",
            controller: ['$scope', function ($scope) {
              $scope.new_project_name = "";
              $scope.newProject = function () {
                if ($scope.new_project_name === "") {
                  return false;
                } else {
                  // TODO: goto new project here.
                  $scope.$close();
                }
              };
            }]
          });
        };
      }])
  // Settings service.
  .service('settings-service', ['$rootScope', '$modal', 'socket', 'error-service', '$q',
      function ($rootScope, $modal, ws, errors, $q) {
        var self = this;
        self.settings =  {
          font_size  : 10,
          edit_mode  : "standard",
          tab_width  : 4,
          text_style : "neat"
        };
        self.notify = [];

        function notifyChanges () {
          _.forEach(self.notify, function (x) {x();});
        }

        self.load = function () {
          return $q.when(ws.socket.getSettings()).then(function (settings) {
            if (settings)
              self.settings = settings;
            notifyChanges();
          }).catch(function (message) {
            errors.report(message, "Could not load settings from server.");
          });
        };

        self.save = function () {
          return $q.when(ws.socket.saveSettings(self.settings));
        };

        self.dialog = function () {
          return $modal.open({
            templateUrl: "frontend/templates/settings-template.html",
            controller: ['$scope', function ($scope) {
              $scope.temp = _.clone(self.settings);
              $scope.saveSettings = function () {
                $scope.$close();
                self.settings = $scope.temp;
                self.save().then(notifyChanges).catch(
                  function (error) {
                    errors.report(error, "Could not save settings!");
                  });
                return true;
              };}]
            });
        };
      }])
  // Main controller
  .controller('FrontendController', ['$scope', 'socket', '$q', 'error-service', '$modal', 'ConfirmationMessageModal', 'cookieStore', '$window', 'settings-service',
      function ($scope, ws, $q, errors, $modal, confirm, cookieStore, $window, settings) {
        "use strict";
        var self = this;
        self.timeout = false;
        self.disconnected = false;
        self.failed = false;
        self.errors = errors;

        // Help function
        self.help = function () {
          $modal.open({templateUrl: "frontend/templates/help-template.html"});
        };
        // Logout
        self.logout = function () {
          confirm("Log out of Seashell",
            "Do you wish to logout?  Any unsaved data will be lost.")
            .result.then(function () {
              cookieStore.remove("seashell-session");
              $window.top.location = "https://cas.uwaterloo.ca/logout";
            });
        };
        // Settings
        self.settings = function () {
          settings.dialog();
        };
        // Reconnect
        self.reconnect = function () {
          ws.connect();
        };

        // This won't leak memory, as FrontendController stays in scope all the time.
        ws.register_callback('timein', function () {self.timeout = false;});
        ws.register_callback('timeout', function () {self.timeout = true;});
        ws.register_callback('connected',
            function () {self.disconnected = false; self.timeout = false; self.failed = false;}, true);
        ws.register_callback('disconnected', function () {self.disconnected = true;}, true);
        ws.register_callback('failed', function () {self.failed = true;}, true);
      }])
  // Controller for Project Lists
  .controller('ProjectListController', ['projectList',
      'NewProjectModal', 'DeleteProjectModal', 'error-service',
      function (projectList, newProjectModal, deleteProjectModal, errors) {
    var self = this;
    self.projectList = projectList;
    self.state = "list-projects";

    /** Delete onClick handler. */
    self.delete = function(project) {
      deleteProjectModal(project).then(function () {
        self.projectList.refresh();
      });
    };

    /** New Project Handler */
    self.new = function() {
      newProjectModal().then(function () {
        self.projectList.refresh();
      });
    };

    /** Fetch onClick handler. */
    self.fetch = function () {
      return projects.fetch().catch(function (projects) {
        errors.report(projects, 'Could not fetch projects.');
      }).then(function () {
        self.projectList.refresh();
      });
    };

    // Tests if project is deleteable
    self.isDeletable = function(project) {
      return ! /^[aA][0-9]+/.test(project);
    };
  }])
  // Project controller.
  .controller("ProjectController", ['$state', '$stateParams', '$scope', 'projects', 'error-service',
      'openProject',
    function($state, $stateParams, $scope,  errors, openProject) {
      var self = this;
      self.state = 'edit-project';
      self.project = openProject;
    }])
  // Configuration for routes
  .config(['$stateProvider', '$urlRouterProvider', function ($stateProvider, $urlRouterProvider) {
    $urlRouterProvider.otherwise('/');
    $stateProvider
      .state("list-projects", {
        url: "/",
        templateUrl: "frontend/templates/project-list-template.html",
        controller: "ProjectListController as projects",
        resolve: {projectList: ['$q', 'projects', 'error-service', 'socket', function ($q, projects, errors, ws) {
            return new function () {
              var self = this;
              self.list = [];
              self.question_list = [];
              /** Run this every time the state associated with this controller is loaded.
               *  Returns a deferred that resolves when the state is properly loaded */
              self.refresh = function () {
                return projects.list().then(function (projects_list) {
                  self.list = projects_list;

                  return $q.when(_.map(projects_list, function (project) {
                    return projects.open(project, 'none').then(function (project_object) {
                      var questions = project_object.questions();
                      self.question_list[project] = questions;
                    });
                  }));
                }).catch(function (error) {
                  errors.report(error, "Could not generate list of projects.");
                });
              };
              /** Store the key into our callback [this is important, as a new object
               *  is created every time into this state, and we'll have to remove the CB
               *  as to not leave a dangling reference]. 
               *
               *  Great manual memory management in JavaScript.
               */
              var cb_key = ws.register_callback('connected', function () {self.refresh();}, true);
              self.destroy = function () {
                ws.unregister_callback(cb_key);
              };
            }();
          }]},
        onExit: ['projectList', function (projectList) {
          projectList.destroy();
        }]
        })
      .state("edit-project", {
        url: "/project/{project}",
        templateUrl: "frontend/templates/project-template.html",
        controller: "ProjectController as projectView",
        resolve: {openProject: ['projects', '$stateParams', function(projects, $stateParams) {
          return projects.open($stateParams.project).catch(function (error) {
            errors.report(error, sprintf("Could not open project %s!", self.arguments.project));
            $state.go('list-projects');
          });
        }]},
        onExit: ['openProject', function (project) {
          project.close();
        }]
      })
      .state("edit-project.edit-file", {
        url: "/edit?part&file",
        templateUrl: "frontend/templates/project-editor-file-template.html",
        controller: "ProjectEditFileController as editView"
      });
  }])
  .run(['cookie', 'socket', 'settings-service', 'error-service', 'projects', function(cookies, ws, settings, errors, projects) {
    /** TODO: This may need to go somewhere else. */
    ws.connect()
        .then(function () {
          return projects.fetch().catch(function (projects) {
            errors.report(projects, 'Could not fetch projects.');
          });
        });
    // Reload settings on (re)connect.
    ws.register_callback('connected', function () {
      return settings.load().catch(function (error) {
        errors.report(error, 'Could not load settings!');
      });
    });
  }]);
