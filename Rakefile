desc 'Install rc files'
task :install do
  if File.exists?(File.expand_path("~/.inputrc"))
    puts 'Skipping installation of .inputrc, as it is already present'
  else
    puts 'Adding .inputrc'
    base_path = Rake.application.original_dir
    sh "cp #{File.join(base_path, 'rc_files', 'inputrc')} ~/.inputrc"
  end
end
